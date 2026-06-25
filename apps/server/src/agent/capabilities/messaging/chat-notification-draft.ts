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
 * - 条数标签：本窗口内该会话消息数 > 1 时显示 `[N 条消息]`（N 超 99 显 `99+`）。
 * - @标签：窗口内有人 @ 过小镜时显示 `[有人 @ 你]`（出现过一次就粘住）。
 *
 * 折叠约定 this = 最新、prev = 历史：文本取最新、`mentioned` 粘住（OR）、`messageCount`
 * 累加。sourceId = 会话 id（每会话一个源）。
 */
export class ChatNotificationDraft implements NotificationDraft {
  public readonly group = "QQ";

  public constructor(
    public readonly sourceId: string,
    public readonly displayName: string,
    private readonly latestText: string,
    private readonly mentioned: boolean,
    private readonly messageCount = 1,
  ) {}

  public merge(prev: NotificationDraft): NotificationDraft {
    const previous = prev as ChatNotificationDraft;
    return new ChatNotificationDraft(
      this.sourceId,
      this.displayName,
      this.latestText, // 最新归我
      this.mentioned || previous.mentioned, // @ 粘住
      this.messageCount + previous.messageCount, // 条数累加
    );
  }

  public render(): string {
    const countTag = this.messageCount > 1 ? `[${formatCount(this.messageCount)} 条消息]` : "";
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
