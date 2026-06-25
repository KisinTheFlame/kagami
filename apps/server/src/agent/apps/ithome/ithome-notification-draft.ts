import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";
import { ITHOME_APP_ID } from "./ithome.app.js";

/**
 * IT之家的后台通知 draft（手机 OS 模型）。
 *
 * 一个窗口内来的多篇文章折叠成一条：`IT之家：N篇新文，最新《标题》`。
 * 折叠约定 this = 最新、prev = 历史：标题取最新、篇数累加。
 */
export class IthomeNotificationDraft implements NotificationDraft {
  public readonly sourceId = ITHOME_APP_ID;
  public readonly displayName = "IT之家";
  private readonly count: number;
  private readonly latestTitle: string;

  public constructor({ title, count = 1 }: { title: string; count?: number }) {
    this.latestTitle = title;
    this.count = count;
  }

  public merge(prev: NotificationDraft): NotificationDraft {
    const previous = prev as IthomeNotificationDraft;
    return new IthomeNotificationDraft({
      title: this.latestTitle,
      count: previous.count + this.count,
    });
  }

  public render(): string {
    return `IT之家：${this.count}篇新文，最新《${this.latestTitle}》`;
  }
}
