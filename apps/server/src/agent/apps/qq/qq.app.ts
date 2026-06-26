import type { App } from "@kagami/agent-runtime";
import {
  renderGroupMessagePlainText,
  renderPrivateMessagePlainText,
} from "../../runtime/context/context-message-factory.js";
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
} from "../../../napcat/service/napcat-gateway.service.js";
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
} from "../../capabilities/messaging/conversation-id.js";
import { OpenConversationTool } from "./tools/open-conversation.tool.js";
import { BackToConversationListTool } from "./tools/back-to-conversation-list.tool.js";
import { ViewForwardTool } from "./tools/view-forward.tool.js";
import type { ToolComponent } from "@kagami/agent-runtime";

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
};

/**
 * QQ App（手机 OS 模型，B 形态：持久当前会话视图）。
 *
 * 取代旧聊天状态树：自己持会话表（群 + 私聊）、订阅 napcat、来消息向
 * NotificationCenter push 通知。内部维护"当前会话"——open_conversation 打开并停在
 * 那、send_message 发给当前、back_to_conversation_list 回列表。
 *
 * 所有进来的消息都走 center 成通知（含当前会话，不做实时 append）；current 只决定
 * send 目标 + onFocus 渲染谁。读会话内容靠 open_conversation。
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

  public constructor({
    napcatGateway,
    notificationCenter,
    botQQ,
    listenGroupIds,
    recentMessageLimit,
    sendMessageTool,
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
      new OpenConversationTool({ getApp: () => this }),
      new BackToConversationListTool({ getApp: () => this }),
      new ViewForwardTool({ getApp: () => this }),
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
      "  - open_conversation(id): 打开某个会话，看最近消息并停在那；之后 send_message 发给它。",
      "  - send_message(message): 发到当前打开的会话。先 open_conversation 才能发。",
      "  - back_to_conversation_list(): 离开当前会话、回到会话列表。",
      "  - view_forward(forward_id): 展开查看合并转发。消息里看到 [forward_id: xxx] 就是一条合并转发（聊天记录），把那个 id 传进来即可；默认显示前 50 条，更长用 offset 翻页。",
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

  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    this.currentConversationId = null;
    return [{ type: "append_message", content: this.renderConversationList() }];
  }

  public async onBlur(): Promise<readonly RootAgentEffect[]> {
    this.currentConversationId = null;
    return [];
  }

  /** 关停：停掉网关 WS（收纳后由 QQ App 负责，经 AppManager.shutdownAll 反序触发）。 */
  public async onShutdown(): Promise<void> {
    await this.napcatGateway.stop();
  }

  /** session.getCurrentChatTarget 委派到这里：当前会话的发送目标。 */
  public getCurrentChatTarget(): NapcatChatTarget | undefined {
    if (!this.currentConversationId) {
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

  /** open_conversation 工具调用：设当前会话、渲染最近消息、清未读 + 清该会话待发通知。 */
  public async openConversation(
    id: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    const conversation = this.conversations.get(id as ConversationId);
    if (!conversation) {
      return { ok: false, error: "CONVERSATION_NOT_FOUND" };
    }

    const hadEntered = conversation.hasEntered();
    const recent = hadEntered
      ? conversation.consumeUnreadTail()
      : await this.fetchRecent(conversation);
    if (!hadEntered) {
      conversation.clearUnread();
    }
    conversation.markEntered();
    this.currentConversationId = conversation.id;
    this.notificationCenter.clearForSource(conversation.id);

    return { ok: true, content: this.renderConversation(conversation, recent) };
  }

  /** back_to_conversation_list 工具调用：离开当前会话、回列表。 */
  public backToConversationList(): { ok: boolean; content: string } {
    this.currentConversationId = null;
    return { ok: true, content: this.renderConversationList() };
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
      lines.push(`- ${conversation.getDisplayName()}${unreadText} [id: ${conversation.id}]`);
    }
    lines.push("用 open_conversation(id) 打开一个会话。");
    lines.push("</qq_conversation_list>");
    return lines.join("\n");
  }

  private renderConversation(conversation: Conversation, recent: ConversationMessage[]): string {
    const lines = [`<qq_conversation name="${conversation.getDisplayName()}">`];
    if (recent.length === 0) {
      lines.push("（暂无最近消息）");
    } else {
      for (const message of recent) {
        lines.push(renderMessagePlainText(message));
      }
    }
    lines.push("用 send_message 发言，或 back_to_conversation_list 回列表。");
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
      `还有 ${total - shownEnd} 条，继续看用 view_forward(forward_id="${forwardId}", offset=${shownEnd})。`,
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

function parseConversationGroupId(id: ConversationId): string | null {
  return id.startsWith("qq_group:") ? id.slice("qq_group:".length) : null;
}

function parseConversationUserId(id: ConversationId): string | null {
  return id.startsWith("qq_private:") ? id.slice("qq_private:".length) : null;
}
