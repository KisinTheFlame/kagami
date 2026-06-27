import { AppLogger } from "../../../../logger/logger.js";
import { TODO_LIST_RENDER_LIMIT } from "./todo.constants.js";
import type { DigestSummary, DueReminder, TodoService } from "./todo.service.js";

const logger = new AppLogger({ source: "todo.reminder-poller" });

type TodoReminderPollerDeps = {
  todoService: TodoService;
  /** 每条到点提醒回调一次（由上层构造 TodoReminderDraft 并 push）。 */
  onDueReminder: (reminder: DueReminder) => void;
  /** 每日 digest 有未完成项时回调一次（由上层构造 TodoDigestDraft 并 push）。 */
  onDigest: (summary: DigestSummary) => void;
};

/**
 * 到点提醒 + 每日回顾的执行体。两个方法都 catch+log 不 rethrow——一次 DB 抖动只丢这
 * 一拍，不让 ScheduledTask 被当成 error 而中断（仿 IthomePoller）。
 *
 * 自身不构造任何 NotificationDraft：到点/汇总以纯数据经回调交给 server-runtime 构造并 push，
 * 保持 capabilities 层不依赖 apps 层。
 */
export class TodoReminderPoller {
  private readonly todoService: TodoService;
  private readonly onDueReminder: (reminder: DueReminder) => void;
  private readonly onDigest: (summary: DigestSummary) => void;

  public constructor({ todoService, onDueReminder, onDigest }: TodoReminderPollerDeps) {
    this.todoService = todoService;
    this.onDueReminder = onDueReminder;
    this.onDigest = onDigest;
  }

  /** 一个 reminder tick：收集到点项并逐条回调。空拍零回调、零 push。 */
  public async runOnce(): Promise<void> {
    try {
      const due = await this.todoService.collectDueReminders();
      for (const reminder of due) {
        this.onDueReminder(reminder);
      }
    } catch (error) {
      logger.warn("Failed to run todo reminder tick", {
        event: "todo.reminder_tick_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 每日回顾：有未完成项才回调。 */
  public async runDigest(): Promise<void> {
    try {
      const summary = await this.todoService.buildDigest({ limit: TODO_LIST_RENDER_LIMIT });
      if (summary.totalCount > 0) {
        this.onDigest(summary);
      }
    } catch (error) {
      logger.warn("Failed to run todo daily digest", {
        event: "todo.digest_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
