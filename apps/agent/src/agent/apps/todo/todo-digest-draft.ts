import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";
import { TODO_NOTIFICATION_GROUP } from "./todo-reminder-draft.js";

/**
 * 待办回顾的通知 draft（手机 OS 模型）：App 级的每日两次（09:00 / 21:00）统一提醒。
 *
 * 单一 `sourceId="todo:digest"`，每次回顾一条；items 已由 service 封顶。渲染分两段：
 *   1. 未完成项汇总（空待办时给兜底文案）；
 *   2. 固定提示小镜去 todo App 按自己打算做的事添新待办。
 * 两次回顾间隔 12h、互不重叠，merge 取最新即可。
 */
export class TodoDigestDraft implements NotificationDraft {
  public readonly sourceId = "todo:digest";
  public readonly group = TODO_NOTIFICATION_GROUP;
  public readonly displayName = TODO_NOTIFICATION_GROUP;
  private readonly totalCount: number;
  private readonly titles: string[];

  public constructor({ totalCount, items }: { totalCount: number; items: { title: string }[] }) {
    this.totalCount = totalCount;
    this.titles = items.map(item => item.title);
  }

  public merge(_prev: NotificationDraft): NotificationDraft {
    return this;
  }

  public render(): string {
    const nudge = "顺便想想接下来打算做什么，去 todo App 按自己的计划添几条新待办吧。";
    if (this.totalCount === 0) {
      return `待办都清空了，没有未完成的事。${nudge}`;
    }
    const listed = this.titles.map(title => `《${title}》`).join("");
    const hidden = this.totalCount - this.titles.length;
    const tail = hidden > 0 ? `…（其余 ${hidden} 件）` : "";
    return `还有 ${this.totalCount} 件没做：${listed}${tail}。${nudge}`;
  }
}
