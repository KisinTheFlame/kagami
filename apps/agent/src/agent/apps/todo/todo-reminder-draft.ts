import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";

export const TODO_NOTIFICATION_GROUP = "待办";

/**
 * 单条到点提醒的通知 draft（手机 OS 模型）。
 *
 * 每条 todo 一个 `sourceId="todo:reminder:{id}"`（细粒度，仿 QQ 每会话一源），多条到期
 * 各占一行：`《标题》到点了`。同一 todo 在同一节流窗内极少被 push 两次（重复项周期 ≫ 窗），
 * 故 merge 直接取最新。
 */
export class TodoReminderDraft implements NotificationDraft {
  public readonly sourceId: string;
  public readonly group = TODO_NOTIFICATION_GROUP;
  public readonly displayName = TODO_NOTIFICATION_GROUP;
  private readonly title: string;

  public constructor({ id, title }: { id: number; title: string }) {
    this.sourceId = `todo:reminder:${id}`;
    this.title = title;
  }

  public merge(_prev: NotificationDraft): NotificationDraft {
    return this;
  }

  public render(): string {
    return renderServerStaticTemplate(import.meta.url, "context/notifications/todo-reminder.hbs", {
      title: this.title,
    });
  }
}
