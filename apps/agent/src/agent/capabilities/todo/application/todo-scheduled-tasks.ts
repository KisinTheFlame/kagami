import type { SchedulerTaskRegistration } from "@kagami/scheduler-client/types";
import { DAILY_DIGEST_CRON, REMINDER_TICK_MS } from "./todo.constants.js";
import type { TodoReminderPoller } from "./todo-reminder-poller.js";

/**
 * TODO 的两个定时任务注册（甲：定义在使用方，issue #428）。schedule 仍用模块常量字面值（不进
 * config.yaml），handler 留在本进程。
 * - `todo:reminder-tick`：interval，misfire=latest（不追赶断连期间的每一拍）+ overlap=skip
 *   （并发扫 due reminder 危险，本地 mutex 兜住，等价拆分前行为）。
 * - `todo:daily-digest`：cron，misfire=catchup·1 + dedupe（无条件 push 日报，重复触发=重复日报，
 *   靠 occurrenceId 去重 + 最多补最近 1 个 slot）。
 */
export function buildTodoScheduledTasks({
  todoReminderPoller,
}: {
  todoReminderPoller: TodoReminderPoller;
}): SchedulerTaskRegistration[] {
  return [
    {
      name: "todo:reminder-tick",
      schedule: { kind: "interval", intervalMs: REMINDER_TICK_MS },
      misfire: "latest",
      overlap: "skip",
      handler: async () => {
        await todoReminderPoller.runOnce();
      },
    },
    {
      name: "todo:daily-digest",
      schedule: { kind: "cron", expression: DAILY_DIGEST_CRON },
      misfire: "catchup",
      maxCatchup: 1,
      overlap: "skip",
      dedupe: true,
      handler: async () => {
        await todoReminderPoller.runDigest();
      },
    },
  ];
}
