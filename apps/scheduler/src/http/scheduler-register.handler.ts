import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { schedulerApiContract } from "@kagami/scheduler-api/contract";
import type { SchedulerEngine } from "../application/scheduler-engine.js";

type SchedulerRegisterHandlerDeps = {
  engine: SchedulerEngine;
};

/**
 * 注册 + 状态查询路由（issue #428）。register：使用方提交完整任务集，引擎 replace-all。
 * status：按 ownerId 回 tick 侧状态（nextRunAt / lastScheduledAt / lastEmittedAt）；使用方 SDK
 * 会把它与本地执行历史合并成 web 观测视图。
 */
export class SchedulerRegisterHandler {
  private readonly engine: SchedulerEngine;

  public constructor({ engine }: SchedulerRegisterHandlerDeps) {
    this.engine = engine;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, schedulerApiContract.register, ({ input }) => {
      return this.engine.register(input);
    });

    registerJsonRoute(app, schedulerApiContract.status, ({ input }) => {
      return this.engine.status(input.ownerId);
    });
  }
}
