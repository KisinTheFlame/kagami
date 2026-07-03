import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { metricApiContract } from "@kagami/metric-api/contract";
import type { MetricRecordService } from "../application/metric-record.service.js";

type MetricRecordHandlerDeps = {
  metricRecordService: MetricRecordService;
};

/** 打点摄取路由。路由与 schema 的单一事实源在 @kagami/metric-api（#279 PR3）。 */
export class MetricRecordHandler {
  private readonly metricRecordService: MetricRecordService;

  public constructor({ metricRecordService }: MetricRecordHandlerDeps) {
    this.metricRecordService = metricRecordService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, metricApiContract.record, async ({ input }) => {
      await this.metricRecordService.record(input);
      return { ok: true as const };
    });
  }
}
