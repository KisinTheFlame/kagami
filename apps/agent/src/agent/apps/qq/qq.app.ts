import type { App, JsonValue } from "@kagami/agent-runtime";
import { renderGroupMessagePlainText, renderPrivateMessagePlainText } from "./qq-message-render.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { NotificationCenter } from "../../runtime/root-agent/notification/notification-center.js";
import type {
  NapcatAgentEvent,
  NapcatChatTarget,
  NapcatForwardMessagePage,
  NapcatFriendInfo,
  NapcatGatewayService,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../napcat/application/napcat-gateway.service.js";
import {
  ChatNotificationDraft,
  detectBotMentioned,
} from "../../capabilities/messaging/chat-notification-draft.js";
import {
  Conversation,
  type ConversationMessage,
} from "../../capabilities/messaging/conversation.js";
import {
  type ConversationId,
  createGroupConversationId,
  createPrivateConversationId,
  isConversationId,
} from "../../capabilities/messaging/conversation-id.js";
import { AppLogger } from "@kagami/kernel/logger/logger";
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

export const QQ_APP_ID = "qq";

/** view_forward 每页条数（默认显示前 50 条，其余靠 offset 翻页）。 */
const FORWARD_PAGE_SIZE = 50;
/** 转发里单条消息渲染上限，超出截断，防止个别超长消息把一页撑爆。 */
const FORWARD_NODE_MAX_CHARS = 1000;

type QqAppDeps = {
  napcatGateway: NapcatGatewayService;
  notificationCenter: NotificationCenter;
  botQQ: string;
  listenGroupIds: string[];
  recentMessageLimit: number;
  /** 已构造好的 send_message 工具（带 AI 味门控等依赖），由 factory 注入。 */
  sendMessageTool: ToolComponent;
  /** 已构造好的 send_resource 工具（按 resid 发图），由 factory 注入。 */
  sendResourceTool: ToolComponent;
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
 * 所有进来的消息都走 center 成通知（含当前会话，不做实时 append）；current 只决定
 * send 目标 + onFocus 渲染谁。读会话内容靠 open_conversation / onFocus 补档。
 */
export class QqApp implements App {
  public readonly id = QQ_APP_ID;
  public readonly displayName = "QQ";
  public readonly tools: readonly ToolComponent[];

  private readonly napcatGateway: NapcatGatewayService;
  private readonly notificationCenter: NotificationCenter;
  private readonly botQQ: string;
  private readonly recentMessageLimit: number;
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
    botQQ,
    listenGroupIds,
    recentMessageLimit,
    sendMessageTool,
    sendResourceTool,
  }: QqAppDeps) {
    this.napcatGateway = napcatGateway;
    this.notificationCenter = notificationCenter;
    this.botQQ = botQQ;
    this.recentMessageLimit = recentMessageLimit;
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
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return [
      "你在 QQ App 里。这里是你的 QQ 会话列表（群 + 私聊）。",
      "",
      "可调用工具：",
      "  - list_conversations(): 列出当前已知的会话（群 + 私聊）含未读数，并标出你现在停在哪个会话。纯读，不改变焦点。",
      "  - open_conversation(id): 打开/切换到某个会话，看最近消息并停在那；之后 send_message 发给它。任意时刻都能直接切换到别的会话，不用先回列表。",
      "  - send_message(message): 发到当前打开的会话。先 open_conversation 才能发。想发 QQ 内置表情就在文本里写 `[表情: 名字]`（和你收到的格式一样，如 `[表情: 比心]`），会自动转成表情发出；名字不认得就原样当文字发。",
      "  - send_resource(resid, caption?, reply_to?): 按 resid 把一张已存图片发到当前会话。resid 形如 res-N（取自消息里 [resid: res-N] 占位符或截图返回）。先 open_conversation 才能发；目前只支持图片。",
      "  - list_faces(): 列出所有可发送的 QQ 内置表情名字。不确定有哪些表情、名字怎么写时调它查。",
      "  - view_forward(forward_id): 展开查看合并转发。消息里看到 [forward_id: fwd-xxx] 就是一条合并转发（聊天记录），把 fwd-xxx 原样作为字符串复制进来（含 fwd- 前缀，别当数字）；默认显示前 50 条，更长用 offset 翻页。",
      "",
      "新消息会以通知形式提醒你（不在这个 App 里也会）。调 back_to_portal 退出 QQ 回桌面。",
    ].join("\n");
  }

  public async onStartup(): Promise<void> {
    // napcat 网关收纳进 QQ App：由这里起 WS 连接（先连上，下面拉群信息才有效）。
    await this.napcatGateway.start();
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
            conversation.setGroupInfo(await this.napcatGateway.getGroupInfo({ groupId }));
          } catch {
            // 群信息拉不到就退化为 groupId 显示。
          }
        }),
    );
  }

  /**
   * 回到 QQ：进入前台，渲染会话列表（标注当前焦点）。若有保留的当前会话，补上它在后台期间
   * 收到的消息（走 enterConversation 那条清未读 + 清通知 + 渲染的统一路径）。current 跨 blur
   * 保留，所以不在这里清空。整体仍是单条 append_message，KV 友好。
   */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    this.focused = true;
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
    return [{ type: "append_message", content: sections.join("\n") }];
  }

  /** 退到后台：保留当前会话焦点（回来续上），仅退出前台——getCurrentChatTarget 随即对外停摆。 */
  public async onBlur(): Promise<readonly RootAgentEffect[]> {
    this.focused = false;
    return [];
  }

  /** 关停：停掉网关 WS（收纳后由 QQ App 负责，经 AppManager.shutdownAll 反序触发）。 */
  public async onShutdown(): Promise<void> {
    await this.napcatGateway.stop();
  }

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

    // 私聊消息
    const conversation = this.ensurePrivateConversation(event.data.userId, {
      userId: event.data.userId,
      nickname: event.data.nickname,
      remark: event.data.remark,
    });
    this.ingestMessage(conversation, event.data, false);
  }

  /** open_conversation 工具调用：把某个会话设为当前并渲染（清未读 + 清该会话待发通知）。 */
  public async openConversation(
    id: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    const conversation = this.conversations.get(toConversationId(id));
    if (!conversation) {
      return { ok: false, error: "CONVERSATION_NOT_FOUND" };
    }
    return { ok: true, content: await this.enterConversation(conversation) };
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
    const recent = hadEntered
      ? conversation.consumeUnreadTail()
      : await this.fetchRecent(conversation);
    if (!hadEntered) {
      conversation.clearUnread();
    }
    conversation.markEntered();
    this.currentConversationId = conversation.id;
    this.notificationCenter.clearForSource(conversation.id);

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

  private ingestMessage(
    conversation: Conversation,
    message: ConversationMessage,
    mentioned: boolean,
  ): void {
    conversation.pushUnread(message, mentioned);
    // 通知用会话当前的权威未读状态现造 draft：计数 / @ 标记跨窗口累积，open 才清零。
    this.notificationCenter.push(
      new ChatNotificationDraft(
        conversation.id,
        conversation.getShortName(),
        renderMessagePreview(message),
        conversation.hasUnreadMention(),
        conversation.getUnreadCount(),
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
    const lines = ["<qq_conversation_list>", "你的 QQ 会话："];
    for (const conversation of this.conversations.values()) {
      const unread = conversation.getUnreadCount();
      const unreadText = unread > 0 ? `（未读 ${unread}）` : "";
      const currentMark = conversation.id === this.currentConversationId ? "  ← 当前会话" : "";
      lines.push(
        `- ${conversation.getDisplayName()}${unreadText} [id: ${conversation.id}]${currentMark}`,
      );
    }
    lines.push("用 open_conversation(id) 打开/切换任意会话。");
    lines.push("</qq_conversation_list>");
    return lines.join("\n");
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
    const lines = [`<qq_conversation name="${conversation.getDisplayName()}">`];
    if (recent.length === 0) {
      lines.push(emptyHint);
    } else {
      if (olderUnread > 0) {
        lines.push(`（更早 ${olderUnread} 条未读未展示）`);
      }
      for (const message of recent) {
        lines.push(renderMessagePlainText(message));
      }
    }
    lines.push("用 send_message 发言；list_conversations 看会话列表、open_conversation 切换会话。");
    lines.push("</qq_conversation>");
    return lines.join("\n");
  }
}

function isGroupMessage(message: ConversationMessage): message is NapcatGroupMessageData {
  return "groupId" in message;
}

function renderMessagePlainText(message: ConversationMessage): string {
  return isGroupMessage(message)
    ? renderGroupMessagePlainText(message)
    : renderPrivateMessagePlainText(message);
}

/**
 * 通知行里的"最近一条内容"。群消息带上发送者（群里不知谁说的没意义）；私聊不带——
 * 会话名本身就是对方。会话名由通知行前缀给出，这里只补发送者。
 */
function renderMessagePreview(message: ConversationMessage): string {
  const text = message.rawMessage?.trim() || "（非文本消息）";
  return isGroupMessage(message) ? `${message.nickname}：${text}` : text;
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
  return text.length > FORWARD_NODE_MAX_CHARS
    ? `${text.slice(0, FORWARD_NODE_MAX_CHARS)}…（已截断）`
    : text;
}

/** 把 JsonValue 收窄成普通对象（非数组、非 null）；否则返回 null。restoreState 防御用。 */
function asRecord(value: JsonValue): { [key: string]: JsonValue } | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function parseConversationGroupId(id: ConversationId): string | null {
  return id.startsWith("qq_group:") ? id.slice("qq_group:".length) : null;
}

function parseConversationUserId(id: ConversationId): string | null {
  return id.startsWith("qq_private:") ? id.slice("qq_private:".length) : null;
}
