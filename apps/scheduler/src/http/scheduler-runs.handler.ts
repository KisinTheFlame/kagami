import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { schedulerApiContract } from "@kagami/scheduler-api/contract";
import type { TaskRunStore } from "../infra/db/task-run-store.js";

type SchedulerRunsHandlerDeps = {
  store: TaskRunStore;
};

/**
 * run 上报路由（issue #493 P1）。使用方 SDK 上报一次执行历史，按 runId 幂等 upsert 落库后回 ack。
 */
export class SchedulerRunsHandler {
  private readonly store: TaskRunStore;

  public constructor({ store }: SchedulerRunsHandlerDeps) {
    this.store = store;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, schedulerApiContract.reportRun, async ({ input }) => {
      await this.store.upsertRun(input);
      return { ok: true as const };
    });
  }
}
