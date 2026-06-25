import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";
import type { NapcatReceiveMessageSegment } from "../../../napcat/service/napcat-gateway/shared.js";

const MENTION_TAG = "[有人@你]";
const MAX_PREVIEW_CHARS = 40;

/**
 * 一个 QQ 会话的后台通知 draft（手机 OS 模型）。
 *
 * 一个窗口内同会话的多条消息折叠成一行：`{会话名}：{[有人@你] }{最新一条(截断)}`。
 * 折叠约定 this = 最新、prev = 历史：文本取最新、`mentioned` 在窗口内**粘住**
 * （出现过一次 @ 就为真）。sourceId = 会话 id（每会话一个源）。
 */
export class ChatNotificationDraft implements NotificationDraft {
  public constructor(
    public readonly sourceId: string,
    public readonly displayName: string,
    private readonly latestText: string,
    private readonly mentioned: boolean,
  ) {}

  public merge(prev: NotificationDraft): NotificationDraft {
    const previous = prev as ChatNotificationDraft;
    return new ChatNotificationDraft(
      this.sourceId,
      this.displayName,
      this.latestText, // 最新归我
      this.mentioned || previous.mentioned, // @ 粘住
    );
  }

  public render(): string {
    const mark = this.mentioned ? `${MENTION_TAG} ` : "";
    return `${this.displayName}：${mark}${truncate(this.latestText, MAX_PREVIEW_CHARS)}`;
  }
}

/** 群消息里是否 @ 了机器人（at 段的 qq 命中 botQQ）。私聊无 @ 概念，恒为 false。 */
export function detectBotMentioned(
  segments: readonly NapcatReceiveMessageSegment[],
  botQQ: string,
): boolean {
  return segments.some(segment => segment.type === "at" && segment.data.qq === botQQ);
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
