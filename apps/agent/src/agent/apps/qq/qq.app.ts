import type { App, JsonValue } from "@kagami/agent-runtime";
import { truncateWithEllipsis } from "@kagami/kernel/utils/text";
import {
  renderGroupMessagePlainText,
  renderGroupNoticePlainText,
  renderPrivateMessagePlainText,
} from "./qq-message-render.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { NotificationCenter } from "../../runtime/root-agent/notification/notification-center.js";
import type {
  ForegroundInput,
  ForegroundInputSource,
} from "../../runtime/root-agent/foreground-input.js";
import type { NapcatAgentEvent, NapcatGroupBanData } from "@kagami/napcat-api/event";
import type {
  NapcatChatTarget,
  NapcatForwardMessagePage,
  NapcatFriendInfo,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "@kagami/napcat-api/message";
import type { NapcatClient } from "../../../acl/napcat-client.js";
import {
  buildChatNotificationPreview,
  buildNoticePreview,
  ChatNotificationDraft,
  detectBotMentioned,
} from "../../capabilities/messaging/chat-notification-draft.js";
import {
  Conversation,
  type ConversationMessage,
  type GroupNoticeMessage,
  isGroupNotice,
} from "../../capabilities/messaging/conversation.js";
import type { GroupMuteStateStore } from "../../capabilities/messaging/application/group-mute-state.store.js";
import {
  type ConversationId,
  createGroupConversationId,
  createPrivateConversationId,
  isConversationId,
} from "../../capabilities/messaging/conversation-id.js";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { OpenConversationTool } from "./tools/open-conversation.tool.js";
import { ListConversationsTool } from "./tools/list-conversations.tool.js";
import { ViewForwardTool } from "./tools/view-forward.tool.js";
import { ListFacesTool } from "./tools/list-faces.tool.js";
import type { ToolComponent } from "@kagami/agent-runtime";

const logger = new AppLogger({ source: "agent.qq-app" });

/**
 * 把外部入口拿到的 id 解释为 ConversationId。fail-soft：内部既有读路径（DB / 事件里
 * 已存的会话 id）可能不完全符合当前字面规则但仍合法，所以不合规也不 throw，只记 warn
 * 后透传——既消除裸 `as`，又不让宽松数据被新校验拦死。
 */
function toConversationId(id: string): ConversationId {
  if (!isConversationId(id)) {
    logger.warn("Coercing non-canonical conversation id", {
      event: "agent.qq.conversation_id.non_canonical",
      id,
    });
  }
  return id as ConversationId;
}

const QQ_APP_ID = "qq";

/** view_forward 每页条数（默认显示前 50 条，其余靠 offset 翻页）。 */
const FORWARD_PAGE_SIZE = 50;
/** 转发里单条消息渲染上限，超出截断，防止个别超长消息把一页撑爆。 */
const FORWARD_NODE_MAX_CHARS = 1000;

type QqAppDeps = {
  napcatGateway: NapcatClient;
  notificationCenter: NotificationCenter;
  /**
   * 前台输入敲门端口：当前会话在前台收到新消息时调用，enqueue 一个不带内容的
   * foreground_input 事件唤醒主循环（内容在 drain 时经 drainForegroundInput 现拉）。
   * 由 factory 组装闭包注入（含 knock 计数），与 notificationCenter 注入同模式。
   */
  notifyForegroundInput: () => void;
  botQQ: string;
  /** 创造者名字与 QQ 号：进 QQ 后在 help 里披露，方便小镜在群/私聊里认出创造者。 */
  creatorName: string;
  creatorQQ: string;
  listenGroupIds: string[];
  recentMessageLimit: number;
  /** 群禁言状态：禁言事件写、发送工具读。与 DefaultAgentMessageService 共享同一实例。 */
  muteStore: GroupMuteStateStore;
  /** 已构造好的 send_message 工具（带 AI 味门控等依赖），由 factory 注入。 */
  sendMessageTool: ToolComponent;
  /** 已构造好的 send_resource 工具（按 resid 发图），由 factory 注入。 */
  sendResourceTool: ToolComponent;
  /** 群文件三件套（list / download / upload），由 factory 注入（依赖网关 + OSS + fileMaxBytes）。 */
  listGroupFilesTool: ToolComponent;
  downloadGroupFileTool: ToolComponent;
  uploadGroupFileTool: ToolComponent;
};

/**
 * QQ App（手机 OS 模型，B 形态：持久当前会话视图）。
 *
 * 取代旧聊天状态树：自己持会话表（群 + 私聊）、订阅 napcat、来消息向
 * NotificationCenter push 通知。内部维护"当前会话"——open_conversation 随时打开/切换
 * 并停在那、send_message 发给当前；list_conversations 是纯读列表，不动焦点。没有"回列表"
 * 这个状态切换：焦点只由 open_conversation 管。
 *
 * 焦点跨 blur 保留：退到后台（onBlur）不清 currentConversationId，回来（onFocus）能续上
 * 原会话并补看后台期间的消息。但用 focused 标志门控 getCurrentChatTarget——只在前台才对外
 * 暴露发送目标，退出 QQ 后返回 undefined，避免 chatTarget 泄漏到 QQ 之外。focused 不持久化，
 * 重启后为 false。
 *
 * 消息分流（手机 OS 的「屏幕 vs 横幅」）：QQ 在前台且消息属于当前会话时走前台实时
 * 路径——入缓冲 + 敲门（foreground_input 事件），drain 时经 drainForegroundInput 把增量
 * 直接刷进上下文尾部，不经 center；其余（别的会话 / QQ 在后台）照旧走 center 成通知
 * （标签 + 最新一条预览）。小镜自己的回声（botQQ）只入缓冲不敲门不推 center。退化收口在
 * onBlur / 切会话：未投递的未读补推 center draft，绝不静默丢。
 */
export class QqApp implements App, ForegroundInputSource {
  public readonly id = QQ_APP_ID;
  public readonly displayName = "QQ";
  public readonly description = "收发 QQ 群聊与私聊消息，发图、传文件。";
  public readonly tools: readonly ToolComponent[];

  private readonly napcatGateway: NapcatClient;
  private readonly notificationCenter: NotificationCenter;
  private readonly notifyForegroundInput: () => void;
  private readonly botQQ: string;
  private readonly creatorName: string;
  private readonly creatorQQ: string;
  private readonly recentMessageLimit: number;
  private readonly muteStore: GroupMuteStateStore;
  private readonly conversations = new Map<ConversationId, Conversation>();
  private currentConversationId: ConversationId | null = null;
  /**
   * QQ 是否在前台（onFocus 置 true / onBlur 置 false）。门控 getCurrentChatTarget：只在前台
   * 才暴露发送目标，退出 QQ 后即便 currentConversationId 仍保留也不对外泄漏。不持久化。
   */
  private focused = false;

  public constructor({
    napcatGateway,
    notificationCenter,
    notifyForegroundInput,
    botQQ,
    creatorName,
    creatorQQ,
    listenGroupIds,
    recentMessageLimit,
    muteStore,
    sendMessageTool,
    sendResourceTool,
    listGroupFilesTool,
    downloadGroupFileTool,
    uploadGroupFileTool,
  }: QqAppDeps) {
    this.napcatGateway = napcatGateway;
    this.notificationCenter = notificationCenter;
    this.notifyForegroundInput = notifyForegroundInput;
    this.botQQ = botQQ;
    this.creatorName = creatorName;
    this.creatorQQ = creatorQQ;
    this.recentMessageLimit = recentMessageLimit;
    this.muteStore = muteStore;
    for (const groupId of listenGroupIds) {
      const conversation = Conversation.group(groupId, recentMessageLimit);
      this.conversations.set(conversation.id, conversation);
    }
    this.tools = [
      sendMessageTool,
      sendResourceTool,
      new OpenConversationTool({ getApp: () => this }),
      new ListConversationsTool({ getApp: () => this }),
      new ViewForwardTool({ getApp: () => this }),
      new ListFacesTool(),
      listGroupFilesTool,
      downloadGroupFileTool,
      uploadGroupFileTool,
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    // QQ 是众多 App 之一：什么是群聊、消息格式、以及在群聊里怎么发言，都收在 QQ App 自己的
    // help 里按需披露（switch qq + help 时才进上下文尾部），不再写进主 Agent 的稳定前缀。
    return renderServerStaticTemplate(import.meta.url, "prompts/qq-app-help.hbs", {
      botQQ: this.botQQ,
      creatorName: this.creatorName,
      creatorQQ: this.creatorQQ,
    });
  }

  public async onStartup(): Promise<void> {
    // napcat 拆成独立进程（issue #347）：WS 连接归 kagami-napcat，agent 经 HttpNapcatClient 出站、
    // NapcatEventSubscriber 订阅入站。这里只做启动上下文加载（拉群信息 / 恢复全员禁言态）。
    // 拉群信息（显示名）。私聊会话由 friend_list 事件 upsert。
    await Promise.all(
      [...this.conversations.values()]
        .filter(conversation => conversation.kind === "group")
        .map(async conversation => {
          const groupId = parseConversationGroupId(conversation.id);
          if (!groupId) {
            return;
          }
          try {
            const groupInfo = await this.napcatGateway.getGroupInfo({ groupId });
            conversation.setGroupInfo(groupInfo);
            // 重启自愈：全员禁言态从群信息恢复（内存态重启即丢），无需先发一次失败。
            this.muteStore.setWholeGroupMute(groupId, groupInfo.groupAllShut);
          } catch {
            // 群信息拉不到就退化为 groupId 显示。
          }
        }),
    );

    // 好友列表 seed（issue #425）：napcat 拆成独立进程后只在好友列表**变化**时推
    // friend_list_updated，agent 单独重启（napcat 不重启）后收不到已有列表 → 私聊会话列表空到
    // 下一次列表变化 / 收到私聊。启动时主动拉一次 seed，让重启后私聊会话尽快可见。
    // **fire-and-forget，不阻塞启动**：getFriendList 在 napcat 未就绪时会走 HTTP 超时，不该拖住
    // agent 起服；seed 只 upsert 私聊会话、幂等无序，后台完成即可（期间来的私聊消息也会各自
    // ensurePrivateConversation，不依赖 seed 先到）。拉不到就等下一次 friend_list_updated 回填。
    void this.seedPrivateConversationsFromFriendList();
  }

  private async seedPrivateConversationsFromFriendList(): Promise<void> {
    try {
      const friends = await this.napcatGateway.getFriendList?.();
      if (friends) {
        this.handleNapcatEvent({ type: "napcat_friend_list_updated", data: { friends } });
      }
    } catch {
      // 好友列表拉不到（napcat 未就绪等）就退化，等下一次 friend_list_updated 事件回填。
    }
  }

  /**
   * 回到 QQ：进入前台，渲染会话列表（标注当前焦点）。若有保留的当前会话，补上它在后台期间
   * 收到的消息（走 enterConversation 那条清未读 + 清通知 + 渲染的统一路径）。current 跨 blur
   * 保留，所以不在这里清空。整体仍是单条 append_message，KV 友好。
   */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    const current = this.currentConversationId
      ? (this.conversations.get(this.currentConversationId) ?? null)
      : null;
    // 先补档（清掉当前会话未读），再渲染列表——这样列表里当前会话显示的是清零后的未读状态。
    const replay = current
      ? await this.enterConversation(current, "（当前会话期间无新消息）")
      : null;
    const sections = [this.renderConversationList()];
    if (replay) {
      sections.push(replay);
    }
    // focused 在成功路径末尾才翻 true（与 onBlur 的「第一行翻 false」方向相反，安全默认
    // 不同）：若 onFocus 半途抛错、switch 工具失败、session.currentApp 未切换，focused
    // 必须仍是 false——否则前台分流会把消息引向一个永远 drain 不到的敲门，静默滞留。
    this.focused = true;
    return [{ type: "append_message", content: sections.join("\n") }];
  }

  /**
   * 退到后台：保留当前会话焦点（回来续上），仅退出前台——getCurrentChatTarget 随即对外
   * 停摆。前台实时路径的退化出口之一：当前会话还有未投递的未读（敲了门但没等到 drain）
   * 时补推 center draft，回归通知路径，绝不静默丢。也是 reset 失焦广播（blurCurrentApp）
   * 的复用点——**第一行必须同步翻 focused**，即使补推抛错焦点也已归位。
   */
  public async onBlur(): Promise<readonly RootAgentEffect[]> {
    this.focused = false;
    this.pushDegradedDraftForCurrent();
    return [];
  }

  /** 关停：no-op。napcat WS 生命周期归独立进程；agent 侧入站订阅由 server-runtime 停（issue #347）。 */
  public async onShutdown(): Promise<void> {}

  /**
   * 交出未读红点（每会话的 count + @ 标记）给 App 状态持久化能力。只存有未读的会话，
   * 群/好友信息与消息原文不存——重启后从 napcat 实时重建。
   */
  public exportState(): JsonValue {
    const conversations: JsonValue[] = [];
    for (const conversation of this.conversations.values()) {
      const unreadCount = conversation.getUnreadCount();
      if (unreadCount > 0) {
        conversations.push({
          id: conversation.id,
          unreadCount,
          mentioned: conversation.hasUnreadMention(),
        });
      }
    }
    return { version: 1, conversations };
  }

  /** 启动时恢复未读红点。防御性解析：形状 / 版本不认就整体忽略，降级为零未读。 */
  public restoreState(state: JsonValue): void {
    const root = asRecord(state);
    if (!root || root.version !== 1 || !Array.isArray(root.conversations)) {
      return;
    }
    for (const raw of root.conversations) {
      const entry = asRecord(raw);
      if (!entry) {
        continue;
      }
      const { id, unreadCount, mentioned } = entry;
      if (
        typeof id !== "string" ||
        typeof unreadCount !== "number" ||
        typeof mentioned !== "boolean"
      ) {
        continue;
      }
      this.ensureConversationForRestore(id)?.restoreUnread(unreadCount, mentioned);
    }
  }

  /**
   * send_message 工具的 getChatTarget provider（在 qq-app.factory.ts 注入）委派到这里：当前
   * 会话的发送目标。仅在 QQ 处于前台（focused）时返回——current 跨 blur 保留供回来补档，但退出
   * QQ 后不对外暴露发送目标，避免 chatTarget 泄漏到 QQ 之外的顶层能力。
   */
  public getCurrentChatTarget(): NapcatChatTarget | undefined {
    if (!this.focused || !this.currentConversationId) {
      return undefined;
    }
    return this.conversations.get(this.currentConversationId)?.getChatTarget();
  }

  /**
   * 接收 napcat 事件（由 gateway 回调直达，不再走共享事件队列）。群/私聊消息累积进
   * 会话 + push 通知；friend_list upsert 私聊会话。
   */
  public handleNapcatEvent(event: NapcatAgentEvent): void {
    if (event.type === "napcat_friend_list_updated") {
      for (const friend of event.data.friends) {
        this.ensurePrivateConversation(friend.userId, friend);
      }
      return;
    }

    if (event.type === "napcat_group_message") {
      const conversation = this.conversations.get(createGroupConversationId(event.data.groupId));
      if (!conversation) {
        return;
      }
      this.ingestMessage(
        conversation,
        event.data,
        detectBotMentioned(event.data.messageSegments, this.botQQ),
      );
      return;
    }

    if (event.type === "napcat_group_ban") {
      this.handleGroupBan(event.data);
      return;
    }

    // 私聊消息
    const conversation = this.ensurePrivateConversation(event.data.userId, {
      userId: event.data.userId,
      nickname: event.data.nickname,
      remark: event.data.remark,
    });
    this.ingestMessage(conversation, event.data, false);
  }

  /**
   * 群禁言 / 解禁事件：更新禁言状态（自己被禁言 / 解禁、全员禁言开 / 关）+ 作为 group_notice
   * 会话流消息走 ingestMessage（与普通消息完全同路：计未读、推通知、前台敲门）。会话不存在
   * （非监听群，理论上已被网关过滤）则丢弃。
   */
  private handleGroupBan(data: NapcatGroupBanData): void {
    const conversation = this.conversations.get(createGroupConversationId(data.groupId));
    if (!conversation) {
      return;
    }

    const wholeGroup = data.targetUserId === null;
    const selfTargeted = data.targetUserId === this.botQQ;

    // 禁言状态更新（self 与 whole 两维独立）：只有针对小镜自己 / 全员的事件才动 store，
    // 群友被禁言不影响小镜能否发言。
    if (data.subType === "ban") {
      if (wholeGroup) {
        this.muteStore.setWholeGroupMute(data.groupId, true);
      } else if (selfTargeted) {
        this.muteStore.setSelfMute(data.groupId, computeSelfMuteUntil(data));
      }
    } else {
      if (wholeGroup) {
        this.muteStore.setWholeGroupMute(data.groupId, false);
      } else if (selfTargeted) {
        this.muteStore.clearSelfMute(data.groupId);
      }
    }

    const notice: GroupNoticeMessage = {
      kind: "group_notice",
      noticeType: data.subType,
      wholeGroup,
      selfTargeted,
      targetUserId: data.targetUserId,
      targetName: data.targetName,
      operatorUserId: data.operatorUserId,
      operatorName: data.operatorName,
      durationSeconds: data.durationSeconds,
      messageId: null,
      time: data.time,
    };
    this.ingestMessage(conversation, notice, false);
  }

  /** open_conversation 工具调用：把某个会话设为当前并渲染（清未读 + 清该会话待发通知）。 */
  public async openConversation(
    id: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    const conversation = this.conversations.get(toConversationId(id));
    if (!conversation) {
      return { ok: false, error: "CONVERSATION_NOT_FOUND" };
    }
    // 切会话退化：先捕获旧 current 的**对象引用**，enterConversation 成功后再对它扫尾
    // 补推。成功后才推，覆盖两个坑：① enterConversation 的 fetch await 期间旧会话仍是
    // 「前台当前」，新消息走实时路径不进 center——切换完成后它们只剩这次扫尾能接住；
    // ② fetch 抛错时切换未发生、旧会话仍是前台，提前推的 draft 会变成与实况矛盾的
    // 陈旧假通知。显式引用不依赖 currentConversationId，无补错源问题。
    const previous =
      this.currentConversationId && this.currentConversationId !== conversation.id
        ? this.conversations.get(this.currentConversationId)
        : undefined;
    const content = await this.enterConversation(conversation);
    // 自愈 focused：open 成功即在前台（工具只在 QQ 为当前 App 时可达），修复偶发的
    // focused 与 session.currentApp 脱同步。自愈**只属于 openConversation 工具路径**，
    // 不放进共享的 enterConversation——否则 onFocus 的「成功路径末尾才翻 focused」
    // 不变式会被半途的自愈打穿（红队 P2）。
    this.focused = true;
    this.pushDegradedDraftFor(previous);
    return { ok: true, content };
  }

  /** list_conversations 工具调用：纯读会话列表，不改当前焦点（不动 currentConversationId / focused）。 */
  public listConversations(): string {
    return this.renderConversationList();
  }

  /**
   * 进入一个会话：取它的未读（进过的取未读尾、没进过的拉历史）、清未读、设为当前、清该会话
   * 尚未 flush 的待发通知，渲染会话块。openConversation 与 onFocus 补档共用这条统一路径——
   * 一份"清 + 渲染"逻辑。emptyHint 让两个调用点对"无消息"给各自贴切的措辞。
   */
  private async enterConversation(conversation: Conversation, emptyHint?: string): Promise<string> {
    const hadEntered = conversation.hasEntered();
    const unreadBefore = conversation.getUnreadCount();
    let recent: ConversationMessage[];
    if (hadEntered) {
      recent = conversation.consumeUnreadTail();
    } else {
      // fetch 窗口纪律（快照式）：await 期间到达的新消息不能被无脑清未读吞掉。
      // ① 同步快照现有缓冲（持对象引用）；② await 拉历史——抛错时未读原封不动（消费只
      //    发生在成功路径）；③ 成功后按**引用**剔除快照条目（被历史覆盖；按位置剔会在
      //    缓冲位移时误伤新消息）+ 按 messageId 剔除历史已含的新消息（null 保守保留）；
      // ④ 对账：溢出缓冲 / restoreUnread 恢复的裸计数已被历史覆盖，按缓冲重算计数与 @，
      //    否则残留幻影红点、每次 blur 反复推假通知。缓冲剩余 = fetch 没看到的新消息。
      const snapshot = conversation.takeUnreadSnapshot();
      recent = await this.fetchRecent(conversation);
      if (recent.length === 0 && snapshot.length > 0) {
        // 「快照必被历史覆盖」的前提在 fetch 成功但为空时不成立（新群 / 无历史权限
        // 返回空数组是合法响应）：此时剔除快照 = 三处同时吞掉从未展示的内容。退化为
        // 直接展示缓冲（等同 hadEntered 路径），不丢。历史短于缓冲的部分覆盖场景与
        // 旧 clearUnread 行为 parity，接受。
        recent = conversation.consumeUnreadTail();
      } else {
        // group_notice 不在 NapCat 历史里（get_group_msg_history 只含 message）：若把它算进
        // 「必被历史覆盖」的快照里剔掉，就被静默吞了（spec D2）。跳过 notice——它留在缓冲里，
        // 靠下面「首开后 unreadCount>0 即敲门」在下一轮 drain 渲染。
        conversation.dropUnreadInstances(snapshot.filter(message => !isGroupNotice(message)));
        conversation.dropUnreadIn(collectMessageIds(recent));
        conversation.reconcileUnreadWithBuffer();
      }
    }
    conversation.markEntered();
    this.currentConversationId = conversation.id;
    this.notificationCenter.clearForSource(conversation.id);
    // 首次进入的 fetch 窗口内可能漏下增量（当时它还不是当前会话，没走敲门路径；其
    // pending draft 又刚被 clearForSource 清掉）。此刻会话已是当前且在前台——敲一下门，
    // 让下一轮 drain 把它们实时刷出来，不丢也不静默。
    if (!hadEntered && conversation.getUnreadCount() > 0) {
      this.notifyForegroundInput();
    }

    // 仅"进过的会话取未读尾"这条路有意义：未读计数不封顶、内容缓冲封顶，差额即被清掉但未展示的更早未读。
    // 首次进入拉的是历史而非未读，不提示。
    const olderUnread = hadEntered ? Math.max(0, unreadBefore - recent.length) : 0;
    return this.renderConversation(conversation, recent, olderUnread, emptyHint);
  }

  /**
   * view_forward 工具调用：按需展开一条合并转发。不依赖"当前会话"——forward_id 是全局
   * res_id，进了 QQ App 随时能查。结果只作为 tool result 回到尾部，不污染稳定前缀。
   */
  public async viewForward(
    forwardId: string,
    offset: number,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    try {
      const page = await this.napcatGateway.getForwardMessages({
        id: forwardId,
        offset,
        limit: FORWARD_PAGE_SIZE,
      });
      return { ok: true, content: renderForward(forwardId, page) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 入站消息分流（屏幕 vs 横幅）：
   * - 前台 + 当前会话：入缓冲 + 敲门（实时路径，不推 center）；小镜自己的回声只入缓冲
   *   （不计未读、不敲门、不推 center——回声防御，防「自己发言→自己被唤醒」的自持振荡，
   *   见 2026-05-30 空转事故同款拓扑）。
   * - 其余：照旧走 center。通知报信号（未读条数 / 有人@）+ 最新一条真实未读的预览（群聊
   *   带发言人）：用会话当前的权威未读状态现造 draft，计数与 @ 跨窗口累积，open 才清零。
   *   预览只有最新一条且截断，想看全量上下文一律 open_conversation。
   */
  private ingestMessage(
    conversation: Conversation,
    message: ConversationMessage,
    mentioned: boolean,
  ): void {
    // 回声防御在分流最外层：小镜自己的消息无论前后台一律只入缓冲（可见），绝不计未读、
    // 不敲门、不推 center——延迟回声（发完就切走 / blur 后才回）若走通知路径，就是
    // 「自己发言→自己被唤醒」的自持振荡拓扑（2026-05-30 事故同款）。notice 无 userId，
    // 永远不是回声（禁言事件不是小镜发的），跳过回声分支。
    if (!isGroupNotice(message) && message.userId === this.botQQ) {
      conversation.pushEcho(message);
      return;
    }
    const isForegroundCurrent = this.focused && conversation.id === this.currentConversationId;
    if (isForegroundCurrent) {
      conversation.pushUnread(message, mentioned);
      this.notifyForegroundInput();
      return;
    }
    conversation.pushUnread(message, mentioned);
    this.pushDraftFor(conversation);
  }

  /**
   * 前台输入 drain（ForegroundInputSource 实现）。纯内存短路径：只读缓冲 + 模板渲染，
   * 无任何网关 I/O。先渲染后消费：渲染抛错时未读原封不动（session 侧 catch 兜底，输入
   * 不丢）。焦点自查（focused + 有当前会话）与「session 只问当前 App」构成双重校验。
   */
  public async drainForegroundInput(): Promise<ForegroundInput | null> {
    if (!this.focused || !this.currentConversationId) {
      return null;
    }
    const conversation = this.conversations.get(this.currentConversationId);
    if (!conversation) {
      return null;
    }
    // 空判据看**真实未读**而非缓冲长度：回声占缓冲位但不计未读，若只剩回声也注入，
    // stale 敲门就会把小镜自己的发言渲染成「新消息」唤醒新一轮——回声防御被从 drain
    // 侧绕穿（红队实证）。回声留在缓冲里，随下一次真实增量一起上屏。
    const snapshot = conversation.takeUnreadSnapshot();
    if (snapshot.length === 0 || conversation.getUnreadCount() === 0) {
      return null;
    }
    // 计数不封顶、缓冲封顶：差额即被挤掉未展示的更早未读（回声占位会让差额略偏小，接受）。
    const olderUnread = Math.max(0, conversation.getUnreadCount() - snapshot.length);
    const text = renderServerStaticTemplate(
      import.meta.url,
      "context/qq-conversation-new-messages.hbs",
      {
        displayName: conversation.getDisplayName(),
        hasOlderUnread: olderUnread > 0,
        olderUnread,
        // 带 @ 的消息被封顶挤出缓冲时，提示行把这个事实带出来——否则「有人 @ 你」
        // 会随 consumeUnreadTail 清零而从所有输出里消失（后台通知路径反而带得出）。
        squeezedMention: conversation.hasMentionOutsideBuffer(),
        messages: snapshot.map(renderMessagePlainText),
      },
    );
    conversation.consumeUnreadTail();
    return { text, itemCount: snapshot.length };
  }

  /**
   * 退化补推（只准向前）：会话还有未投递的真实未读时，用权威快照计数现造 draft 推回
   * center（merge 取最新，免疫重复累加）。onBlur / 切会话 / reset 失焦广播三个出口共用。
   */
  private pushDegradedDraftFor(conversation: Conversation | undefined): void {
    if (!conversation || conversation.getUnreadCount() <= 0) {
      return;
    }
    this.pushDraftFor(conversation);
  }

  private pushDegradedDraftForCurrent(): void {
    this.pushDegradedDraftFor(
      this.currentConversationId ? this.conversations.get(this.currentConversationId) : undefined,
    );
  }

  /**
   * 用会话当前的权威未读状态现造一条 draft 推给 center（ingest 横幅路径与退化补推共用）。
   * 附带最新一条真实未读的预览（群聊带发言人）；缓冲空（restore 裸计数）时无预览，
   * draft 退回纯标签格式。
   */
  private pushDraftFor(conversation: Conversation): void {
    const latest = conversation.getLatestUnread();
    // notice 无 messageSegments，另走 buildNoticePreview（QQ App 侧渲染裸正文，折叠/截断复用）；
    // 内容消息走 buildChatNotificationPreview（此处 latest 已收窄为非 notice）。
    let preview = null;
    if (latest) {
      preview = isGroupNotice(latest)
        ? buildNoticePreview(renderGroupNoticePlainText(latest, { bare: true }))
        : buildChatNotificationPreview(latest, conversation.kind);
    }
    this.notificationCenter.push(
      new ChatNotificationDraft(
        conversation.id,
        conversation.getShortName(),
        conversation.hasUnreadMention(),
        conversation.getUnreadCount(),
        preview,
      ),
    );
  }

  /**
   * 恢复存档时按 id 定位会话：群会话在监听列表里就用现成的（已下架的不复活）；私聊会话
   * 按 id 现建一个空壳（好友信息留待 friend_list 事件回填）。
   */
  private ensureConversationForRestore(id: string): Conversation | null {
    const conversationId = toConversationId(id);
    const existing = this.conversations.get(conversationId);
    if (existing) {
      return existing;
    }
    const userId = parseConversationUserId(conversationId);
    if (userId) {
      const conversation = Conversation.privateChat(userId, this.recentMessageLimit);
      this.conversations.set(conversation.id, conversation);
      return conversation;
    }
    // 群 id 不在当前监听列表（已下架）→ 不复活。
    return null;
  }

  private ensurePrivateConversation(userId: string, friendInfo: NapcatFriendInfo): Conversation {
    const id = createPrivateConversationId(userId);
    const existing = this.conversations.get(id);
    if (existing) {
      existing.setFriendInfo(friendInfo);
      return existing;
    }
    const conversation = Conversation.privateChat(userId, this.recentMessageLimit);
    conversation.setFriendInfo(friendInfo);
    this.conversations.set(id, conversation);
    return conversation;
  }

  private async fetchRecent(conversation: Conversation): Promise<ConversationMessage[]> {
    if (this.recentMessageLimit <= 0) {
      return [];
    }
    // 拉历史失败不该让 open_conversation 整个硬失败：NapCat 抽风（如锚点消息缺失报
    // 「消息...不存在」）时降级为「暂无最近消息」，会话照常打开、缓冲里的未读仍会兜底展示。
    try {
      return await this.fetchRecentFromNapcat(conversation);
    } catch (error) {
      logger.errorWithCause("Failed to fetch recent messages for conversation", error, {
        event: "agent.qq.fetch_recent_failed",
        conversationId: conversation.id,
      });
      return [];
    }
  }

  private async fetchRecentFromNapcat(conversation: Conversation): Promise<ConversationMessage[]> {
    if (conversation.kind === "group") {
      const groupId = parseConversationGroupId(conversation.id);
      return groupId
        ? await this.napcatGateway.getRecentGroupMessages({
            groupId,
            count: this.recentMessageLimit,
          })
        : [];
    }
    const userId = parseConversationUserId(conversation.id);
    if (!userId) {
      return [];
    }
    const messages = await this.napcatGateway.getRecentPrivateMessages({
      userId,
      count: this.recentMessageLimit,
    });
    return messages
      .filter(
        (message): message is typeof message & { userId: string } => message.userId === userId,
      )
      .map(
        (message): NapcatPrivateMessageData => ({
          userId,
          nickname: message.nickname ?? userId,
          remark: null,
          rawMessage: message.rawMessage,
          messageSegments: message.messageSegments,
          messageId: message.messageId,
          time: message.time,
        }),
      );
  }

  private renderConversationList(): string {
    const conversations = [...this.conversations.values()].map(conversation => {
      const unread = conversation.getUnreadCount();
      return {
        displayName: conversation.getDisplayName(),
        id: conversation.id,
        unreadLabel: unread > 0 ? (unread > 99 ? "99+" : String(unread)) : null,
        isCurrent: conversation.id === this.currentConversationId,
      };
    });
    return renderServerStaticTemplate(import.meta.url, "context/qq-conversation-list.hbs", {
      conversations,
    });
  }

  /**
   * 渲染一个会话块。recent 为本次展示的最近消息；olderUnread > 0 时提示更早未读已清但未展示，
   * 避免"消息缓冲封顶截断 + consumeUnreadTail 全清"造成的信息静默丢失。
   */
  private renderConversation(
    conversation: Conversation,
    recent: ConversationMessage[],
    olderUnread = 0,
    emptyHint = "（暂无最近消息）",
  ): string {
    return renderServerStaticTemplate(import.meta.url, "context/qq-conversation.hbs", {
      displayName: conversation.getDisplayName(),
      isEmpty: recent.length === 0,
      emptyHint,
      hasOlderUnread: olderUnread > 0,
      olderUnread,
      messages: recent.map(message => renderMessagePlainText(message)),
    });
  }
}

function isGroupMessage(message: ConversationMessage): message is NapcatGroupMessageData {
  return "groupId" in message;
}

/** 收集一批消息的非 null messageId（null 无法参与去重匹配，由调用方保守保留）。 */
function collectMessageIds(messages: readonly ConversationMessage[]): Set<number> {
  const ids = new Set<number>();
  for (const message of messages) {
    if (message.messageId !== null) {
      ids.add(message.messageId);
    }
  }
  return ids;
}

function renderMessagePlainText(message: ConversationMessage): string {
  if (isGroupNotice(message)) {
    return renderGroupNoticePlainText(message);
  }
  return isGroupMessage(message)
    ? renderGroupMessagePlainText(message)
    : renderPrivateMessagePlainText(message);
}

/** 把一页合并转发渲染成 <qq_forward> 文本，含分页提示。 */
function renderForward(forwardId: string, page: NapcatForwardMessagePage): string {
  const { nodes, total, offset } = page;
  const lines = [`<qq_forward id="${forwardId}">`];
  if (total === 0) {
    lines.push("（合并转发为空或不可读）");
    lines.push("</qq_forward>");
    return lines.join("\n");
  }

  const shownEnd = offset + nodes.length;
  lines.push(`合并转发共 ${total} 条，显示第 ${offset + 1}-${shownEnd} 条：`);
  for (const node of nodes) {
    const idPart = node.senderUserId ? ` (${node.senderUserId})` : "";
    lines.push(`${node.senderName}${idPart}: ${renderForwardNodeBody(node.rawMessage)}`);
  }
  if (shownEnd < total) {
    lines.push(
      `还有 ${total - shownEnd} 条，继续看用 view_forward(forward_id="fwd-${forwardId}", offset=${shownEnd})。`,
    );
  }
  lines.push("</qq_forward>");
  return lines.join("\n");
}

function renderForwardNodeBody(rawMessage: string): string {
  const text = rawMessage.trim() || "（空消息）";
  // 按码点截断，绝不劈开 emoji 代理对（留下的半个字符会让上下文请求体非法 JSON）。
  return truncateWithEllipsis(text, FORWARD_NODE_MAX_CHARS, "…（已截断）");
}

/** 把 JsonValue 收窄成普通对象（非数组、非 null）；否则返回 null。restoreState 防御用。 */
function asRecord(value: JsonValue): { [key: string]: JsonValue } | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

/**
 * 小镜自己被禁言的到期毫秒时间戳。基准优先用事件 time（秒）——ordered 管线 / WS 积压会让
 * Date.now() 偏晚，据此算到期会偏短、多拦；time 缺失才 fallback 到 Date.now()（spec D8③）。
 */
function computeSelfMuteUntil(data: NapcatGroupBanData): number {
  const baseMs = data.time !== null ? data.time * 1000 : Date.now();
  return baseMs + data.durationSeconds * 1000;
}

function parseConversationGroupId(id: ConversationId): string | null {
  return id.startsWith("qq_group:") ? id.slice("qq_group:".length) : null;
}

function parseConversationUserId(id: ConversationId): string | null {
  return id.startsWith("qq_private:") ? id.slice("qq_private:".length) : null;
}
