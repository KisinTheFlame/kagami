import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { truncateWithEllipsis } from "@kagami/shared/utils";
import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";
import type { ConversationMessage } from "./conversation.js";
import {
  renderSupportedMessageSegments,
  type NapcatReceiveMessageSegment,
} from "../../../napcat/application/napcat-gateway/shared.js";

const MAX_DISPLAY_COUNT = 99;
/** 预览正文截断上限（码点数）：一行通知里给正文留的空间，超出截断加省略号。 */
const PREVIEW_MAX_CHARS = 50;

/**
 * 通知里的最新一条消息预览。senderName 只在群聊时有（发言人昵称）；私聊会话名
 * 本身就是对方，不重复标发送人。text 已折叠空白并截断，直接可渲染。
 */
export type ChatNotificationPreview = {
  senderName: string | null;
  text: string;
};

/**
 * 一个 QQ 会话的后台通知 draft（手机 OS 模型）。
 *
 * 通知带**最新一条消息的预览**：会话名 + 标签之外，附上最近一条真实未读的正文
 * （群聊还带发言人），让小镜不用进会话就能判断值不值得进去。但预览只有最新一条
 * 且会截断——想看全量上下文，仍然要 `open_conversation`。
 *
 * 归到 "QQ" 段下，每会话一行：
 *   `{会话名}: {条数标签}{@标签} {发言人}: {预览正文}`
 * - 条数标签：未读条数 > 1 时显示 `[N 条消息]`（N 超 99 显 `99+`）。
 * - @标签：未读里有人 @ 过小镜时显示 `[有人 @ 你]`。
 * - 预览：缓冲里有真实未读时显示（restoreUnread 恢复的裸计数没有缓冲，无预览）；
 *   群聊带 `{发言人}: ` 前缀，私聊只有正文。
 * - 标签和预览都没有时兜底显示 `有新消息`。
 *
 * **计数与 @ 都不在这里累积**：每条新消息进来时，QQ App 都用会话当前的权威未读状态
 * （`Conversation.getUnreadCount()` / `hasUnreadMention()`）现造一个新 draft。这两者只在
 * open_conversation 时清零，所以未读会跨通知窗口持续累积，而不是每个通知窗口重新计数。
 *
 * 因此折叠约定是**最新快照覆盖**：`merge(prev)` 直接取 `this`（最新快照已带全量未读计数
 * 和最新预览，prev 是过期快照）。sourceId = 会话 id（每会话一个源）。
 *
 * 渲染文案在 `static/context/notifications/qq-chat.hbs`；这里只算 view-model。
 */
export class ChatNotificationDraft implements NotificationDraft {
  public readonly group = "QQ";

  public constructor(
    public readonly sourceId: string,
    public readonly displayName: string,
    private readonly mentioned: boolean,
    private readonly unreadCount: number,
    private readonly preview: ChatNotificationPreview | null = null,
  ) {}

  public merge(_prev: NotificationDraft): NotificationDraft {
    // 最新快照已携带权威未读计数 + @ 标记 + 最新预览，过期的 prev 直接丢弃。
    return this;
  }

  public render(): string {
    const hasCount = this.unreadCount > 1;
    const hasTags = hasCount || this.mentioned;
    return renderServerStaticTemplate(import.meta.url, "context/notifications/qq-chat.hbs", {
      displayName: this.displayName,
      hasTags,
      hasCount,
      countLabel: formatCount(this.unreadCount),
      mentioned: this.mentioned,
      preview: this.preview,
      showFallback: !hasTags && !this.preview,
    });
  }
}

/**
 * 从一条未读消息现算通知预览 view-model：段渲染（@/图片/表情等转占位文本）→ 折叠
 * 空白成单行 → 截断。正文渲染出来是空（如纯不支持段）时返回 null，退回无预览格式。
 */
export function buildChatNotificationPreview(
  message: ConversationMessage,
  kind: "group" | "private",
): ChatNotificationPreview | null {
  const body =
    message.messageSegments.length > 0
      ? renderSupportedMessageSegments(message.messageSegments)
      : message.rawMessage;
  const text = truncateWithEllipsis(body.replace(/\s+/g, " ").trim(), PREVIEW_MAX_CHARS);
  if (!text) {
    return null;
  }
  const senderName = kind === "group" ? message.nickname.trim() || message.userId : null;
  return { senderName, text };
}

/** 群消息里是否 @ 了机器人（at 段的 qq 命中 botQQ）。私聊无 @ 概念，恒为 false。 */
export function detectBotMentioned(
  segments: readonly NapcatReceiveMessageSegment[],
  botQQ: string,
): boolean {
  return segments.some(segment => segment.type === "at" && segment.data.qq === botQQ);
}

function formatCount(count: number): string {
  return count <= MAX_DISPLAY_COUNT ? String(count) : `${MAX_DISPLAY_COUNT}+`;
}
