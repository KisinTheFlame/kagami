import type { SchedulerTaskRegistration } from "@kagami/scheduler-client/types";
import type { IthomePoller } from "./ithome-poller.js";

/**
 * IT之家 RSS 轮询的定时任务注册（甲：定义在使用方，issue #428）。只把 name+schedule+policy 交给
 * kagami-scheduler，handler（跑 syncFeed）留在本进程。misfire=latest（syncFeed 幂等，只关心"现在
 * 该拉一次"）；overlap=skip（上一轮没拉完就跳过，等价拆分前 TaskScheduler 行为）。
 */
export function buildIthomeScheduledTasks({
  ithomePoller,
}: {
  ithomePoller: IthomePoller;
}): SchedulerTaskRegistration[] {
  return [
    {
      name: "ithome:poll",
      schedule: { kind: "interval", intervalMs: ithomePoller.pollIntervalMs },
      misfire: "latest",
      overlap: "skip",
      handler: async () => {
        await ithomePoller.runOnce();
      },
    },
  ];
}
