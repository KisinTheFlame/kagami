import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";
import type {
  SchedulerTaskStatus as AgentSchedulerTaskStatus,
  SchedulerTriggerResponse,
} from "@kagami/agent-api/scheduler";
import type { SchedulerTaskStatus } from "@kagami/scheduler-api/schedule";
import type { SchedulerClient } from "@kagami/scheduler-client/scheduler-client";

type SchedulerViewHandlerDeps = {
  schedulerClient: SchedulerClient;
};

/**
 * 调度任务的 web 观测门面（issue #428）：定时调度拆成独立 kagami-scheduler 进程后，agent 不再进程内
 * 跑 driver。本 handler 从 SchedulerClient 取合并后的状态（nextRunAt 来自调度器 status 查询、
 * recentRuns/isRunning 来自 SDK 本地执行历史）喂给 web，字段与拆分前一致。手动触发在 SDK 本地跑
 * handler（不走调度器）。路由/schema 事实源仍在 @kagami/agent-api。
 */
export class SchedulerViewHandler {
  private readonly schedulerClient: SchedulerClient;

  public constructor({ schedulerClient }: SchedulerViewHandlerDeps) {
    this.schedulerClient = schedulerClient;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, agentApiContract.listSchedulerTasks, async () => {
      const statuses = await this.schedulerClient.listStatus();
      return { tasks: statuses.map(toAgentApiStatus) };
    });

    registerJsonRoute(
      app,
      agentApiContract.triggerSchedulerTask,
      async ({ params }): Promise<SchedulerTriggerResponse> => {
        const result = await this.schedulerClient.triggerNow(params.name);
        if (result.ok) {
          return { ok: true };
        }
        if (result.reason === "unknown_task") {
          // 与拆分前 TaskScheduler.triggerNow 一致：未知任务名抛错（→ 统一错误出口）。
          throw new Error(`unknown scheduled task: ${params.name}`);
        }
        return { ok: false, reason: "overlap" };
      },
    );
  }
}

/** scheduler-api 的通用状态 → agent-api 的 web 状态（同形，逐字段拷贝，两契约不耦合）。 */
function toAgentApiStatus(status: SchedulerTaskStatus): AgentSchedulerTaskStatus {
  return {
    name: status.name,
    schedule: status.schedule,
    nextRunAt: status.nextRunAt,
    isRunning: status.isRunning,
    recentRuns: status.recentRuns,
  };
}
