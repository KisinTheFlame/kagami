import type { ScheduledTask } from "../../../../scheduler/domain/scheduled-task.js";
import type { IthomePoller } from "./ithome-poller.js";

export function buildIthomeScheduledTasks({
  ithomePoller,
}: {
  ithomePoller: IthomePoller;
}): ScheduledTask[] {
  return [
    {
      name: "ithome:poll",
      schedule: { kind: "interval", intervalMs: ithomePoller.pollIntervalMs },
      run: async () => {
        await ithomePoller.runOnce();
      },
    },
  ];
}
