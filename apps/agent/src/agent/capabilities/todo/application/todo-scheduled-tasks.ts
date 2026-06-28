import type { ScheduledTask } from "../../../../scheduler/domain/scheduled-task.js";
import { DAILY_DIGEST_CRON, REMINDER_TICK_MS } from "./todo.constants.js";
import type { TodoReminderPoller } from "./todo-reminder-poller.js";

/**
 * TODO 的两个定时任务，都用模块常量的字面值注册（不进 config.yaml）：
 * - `todo:reminder-tick`：interval，每 REMINDER_TICK_MS 扫一次到点项。
 * - `todo:daily-digest`：cron，每天 DAILY_DIGEST_CRON 汇总未完成项。
 */
export function buildTodoScheduledTasks({
  todoReminderPoller,
}: {
  todoReminderPoller: TodoReminderPoller;
}): ScheduledTask[] {
  return [
    {
      name: "todo:reminder-tick",
      schedule: { kind: "interval", intervalMs: REMINDER_TICK_MS },
      run: async () => {
        await todoReminderPoller.runOnce();
      },
    },
    {
      name: "todo:daily-digest",
      schedule: { kind: "cron", expression: DAILY_DIGEST_CRON },
      run: async () => {
        await todoReminderPoller.runDigest();
      },
    },
  ];
}
