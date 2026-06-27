import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";
import { TODO_NOTIFICATION_GROUP } from "./todo-reminder-draft.js";

/**
 * 每日待办回顾的通知 draft（手机 OS 模型）。
 *
 * 单一 `sourceId="todo:digest"`，一天一条；items 已由 service 封顶。渲染：
 *   `还有 N 件没做：《X》《Y》…（其余 M 件）`
 * digest 一天只 push 一次，merge 取最新即可。
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
    const listed = this.titles.map(title => `《${title}》`).join("");
    const hidden = this.totalCount - this.titles.length;
    const tail = hidden > 0 ? `…（其余 ${hidden} 件）` : "";
    return `还有 ${this.totalCount} 件没做：${listed}${tail}`;
  }
}
