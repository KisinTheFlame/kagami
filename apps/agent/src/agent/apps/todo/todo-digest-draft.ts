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
    const nudge = "顺便想想接下来打算做什么，去 todo App 按自己的计划添几条新待办吧。";
    const head =
      this.totalCount === 0
        ? `待办都清空了，没有未完成的事。${nudge}`
        : `还有 ${this.totalCount} 件没做：${this.renderUnfinished()}。${nudge}`;
    return `${head}${this.renderSuggestions()}`;
  }

  private renderUnfinished(): string {
    const listed = this.titles.map(title => `《${title}》`).join("");
    const hidden = this.totalCount - this.titles.length;
    const tail = hidden > 0 ? `…（其余 ${hidden} 件）` : "";
    return `${listed}${tail}`;
  }

  /** 第三段：有建议才渲染，换行起一段；为空返回空串（整段省略）。 */
  private renderSuggestions(): string {
    if (this.suggestions.length === 0) {
      return "";
    }
    const listed = this.suggestions.map(suggestion => `《${suggestion}》`).join("");
    return `\n这些事你或许可以做：${listed}`;
  }
}
