import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { schedulerApiContract } from "@kagami/scheduler-api/contract";
import type { SchedulerEngine } from "../application/scheduler-engine.js";
import type { TaskRunStore } from "../infra/db/task-run-store.js";

type SchedulerRegisterHandlerDeps = {
  engine: SchedulerEngine;
  store: TaskRunStore;
};

/**
 * 注册 + 状态查询路由（issue #428）。register：使用方提交完整任务集，引擎 replace-all。
 * status：按 ownerId 回 tick 侧状态（nextRunAt / lastScheduledAt / lastEmittedAt）；使用方 SDK
 * 会把它与本地执行历史合并成 web 观测视图。
 *
 * interrupted 自愈（#493 P2）：register 被**接受**时，把上一代（owner_generation < 入参 generation）
 * 还挂着 running 的行标 interrupted——agent 重启（generation 递增）会留下未收到终态的孤儿 running 行。
 * 只标更旧代次，同代重连（scheduler 重启、generation 不变）不误杀在跑的 run。stale register 不处理。
 */
export class SchedulerRegisterHandler {
  private readonly engine: SchedulerEngine;
  private readonly store: TaskRunStore;

  public constructor({ engine, store }: SchedulerRegisterHandlerDeps) {
    this.engine = engine;
    this.store = store;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, schedulerApiContract.register, async ({ input }) => {
      const result = this.engine.register(input);
      if (result.accepted) {
        await this.store.markInterruptedBelow(input.ownerId, input.generation);
      }
      return result;
    });

    registerJsonRoute(app, schedulerApiContract.status, ({ input }) => {
      return this.engine.status(input.ownerId);
    });
  }
}
