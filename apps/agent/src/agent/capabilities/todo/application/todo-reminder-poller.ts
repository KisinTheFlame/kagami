import { AppLogger } from "@kagami/server-core/logger/logger";
import { TODO_LIST_RENDER_LIMIT } from "./todo.constants.js";
import type { DigestSummary, DueReminder, TodoService } from "./todo.service.js";

const logger = new AppLogger({ source: "todo.reminder-poller" });

type TodoReminderPollerDeps = {
  todoService: TodoService;
  /** 每条到点提醒回调一次（由上层构造 TodoReminderDraft 并 push）。 */
  onDueReminder: (reminder: DueReminder) => void;
  /** 每次待办回顾（每天两次）无条件回调一次（由上层构造 TodoDigestDraft 并 push）。 */
  onDigest: (summary: DigestSummary, suggestions: string[]) => void;
  /**
   * 每次回顾时从主 Agent 上下文 fork 一份、发现可做之事，返回最多 5 条候选待办标题。
   * 由上层（装配边界）编排 snapshot → clone → TodoSuggestionService。任何失败自行降级返回 []，
   * 这里再包一层 catch 兜底，保证 digest 永远照发（第三段缺省即省略）。
   */
  suggestTodos: (openTodos: { title: string }[]) => Promise<string[]>;
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
  private readonly onDigest: (summary: DigestSummary, suggestions: string[]) => void;
  private readonly suggestTodos: (openTodos: { title: string }[]) => Promise<string[]>;

  public constructor({
    todoService,
    onDueReminder,
    onDigest,
    suggestTodos,
  }: TodoReminderPollerDeps) {
    this.todoService = todoService;
    this.onDueReminder = onDueReminder;
    this.onDigest = onDigest;
    this.suggestTodos = suggestTodos;
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

  /**
   * 待办回顾：每天两次（09:00 / 21:00）无条件回调一次。
   *
   * 即使当前没有未完成项也照样回调——这条 App 级提醒除了汇总未完成项，还要顺带推动小镜去
   * todo App 按自己打算做的事添新待办，所以空待办时也得发（由 TodoDigestDraft 渲染兜底文案）。
   *
   * 第三段「建议待办」经 suggestTodos（fork 主上下文的一次性发现）取得；它自身已降级返回 []，
   * 这里再 catch 一层，保证 fork 出任何岔子都不影响 digest 照发（第三段为空即省略）。
   */
  public async runDigest(): Promise<void> {
    try {
      const summary = await this.todoService.buildDigest({ limit: TODO_LIST_RENDER_LIMIT });
      const suggestions = await this.suggestTodos(summary.items).catch(() => []);
      this.onDigest(summary, suggestions);
    } catch (error) {
      logger.warn("Failed to run todo daily digest", {
        event: "todo.digest_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
