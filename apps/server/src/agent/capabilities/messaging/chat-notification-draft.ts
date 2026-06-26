import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";
import type { NapcatReceiveMessageSegment } from "../../../napcat/service/napcat-gateway/shared.js";

const MENTION_TAG = "[有人 @ 你]";
const MAX_PREVIEW_CHARS = 40;
const MAX_DISPLAY_COUNT = 99;

/**
 * 一个 QQ 会话的后台通知 draft（手机 OS 模型）。
 *
 * 在通知里归到 "QQ" 段下，每会话一行：
 *   `{会话名}: {条数标签}{@标签}{最近一条内容}`
 * - 条数标签：未读条数 > 1 时显示 `[N 条消息]`（N 超 99 显 `99+`）。
 * - @标签：未读里有人 @ 过小镜时显示 `[有人 @ 你]`。
 *
 * **计数与 @ 都不在这里累积**：每条新消息进来时，QQ App 都用会话当前的权威未读状态
 * （`Conversation.getUnreadCount()` / `hasUnreadMention()`）现造一个新 draft。这两者只在
 * open_conversation 时清零，所以未读会跨通知窗口持续累积，而不是每个 30s 窗口重新计数。
 *
 * 因此折叠约定是**最新快照覆盖**：`merge(prev)` 直接取 `this`（最新快照已带全量未读计数，
 * prev 是过期快照）。sourceId = 会话 id（每会话一个源）。
 */
export class ChatNotificationDraft implements NotificationDraft {
  public readonly group = "QQ";

  public constructor(
    public readonly sourceId: string,
    public readonly displayName: string,
    private readonly latestText: string,
    private readonly mentioned: boolean,
    private readonly unreadCount: number,
  ) {}

  public merge(_prev: NotificationDraft): NotificationDraft {
    // 最新快照已携带权威未读计数 + @ 标记，过期的 prev 直接丢弃。
    return this;
  }

  public render(): string {
    const countTag = this.unreadCount > 1 ? `[${formatCount(this.unreadCount)} 条消息]` : "";
    const mentionTag = this.mentioned ? MENTION_TAG : "";
    return `${this.displayName}: ${countTag}${mentionTag}${truncate(this.latestText, MAX_PREVIEW_CHARS)}`;
  }
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

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
