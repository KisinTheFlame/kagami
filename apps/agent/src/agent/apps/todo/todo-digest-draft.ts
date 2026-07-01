import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";
import { TODO_NOTIFICATION_GROUP } from "./todo-reminder-draft.js";

/**
 * 待办回顾的通知 draft（手机 OS 模型）：App 级的每日两次（09:00 / 21:00）统一提醒。
 *
 * 单一 `sourceId="todo:digest"`，每次回顾一条；items 已由 service 封顶。渲染分三段：
 *   1. 未完成项汇总（空待办时给兜底文案）；
 *   2. 固定提示小镜去 todo App 按自己打算做的事添新待办；
 *   3. （可选）从主 Agent 上下文 fork 发现的具体候选待办；`suggestions` 为空时整段省略。
 * 两次回顾间隔 12h、互不重叠，merge 取最新即可。
 */
export class TodoDigestDraft implements NotificationDraft {
  public readonly sourceId = "todo:digest";
  public readonly group = TODO_NOTIFICATION_GROUP;
  public readonly displayName = TODO_NOTIFICATION_GROUP;
  private readonly totalCount: number;
  private readonly titles: string[];
  private readonly suggestions: string[];

  public constructor({
    totalCount,
    items,
    suggestions = [],
  }: {
    totalCount: number;
    items: { title: string }[];
    suggestions?: string[];
  }) {
    this.totalCount = totalCount;
    this.titles = items.map(item => item.title);
    this.suggestions = suggestions;
  }

  public merge(_prev: NotificationDraft): NotificationDraft {
    return this;
  }

  public render(): string {
    const hidden = this.totalCount - this.titles.length;
    return renderServerStaticTemplate(import.meta.url, "context/notifications/todo-digest.hbs", {
      isEmpty: this.totalCount === 0,
      totalCount: this.totalCount,
      titles: this.titles,
      hasHidden: hidden > 0,
      hidden,
      hasSuggestions: this.suggestions.length > 0,
      suggestions: this.suggestions,
    });
  }
}
