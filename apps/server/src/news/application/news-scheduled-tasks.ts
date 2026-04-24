import type { ScheduledTask } from "../../scheduler/domain/scheduled-task.js";
import type { IthomePoller } from "./ithome-poller.js";

export function buildNewsScheduledTasks({
  ithomePoller,
}: {
  ithomePoller: IthomePoller;
}): ScheduledTask[] {
  return [
    {
      name: "news-poll:ithome",
      schedule: { kind: "interval", intervalMs: ithomePoller.pollIntervalMs },
      run: async () => {
        await ithomePoller.runOnce();
      },
    },
  ];
}
