import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { metricApiContract } from "@kagami/metric-api/contract";
import type { MetricPointsService } from "../application/metric-points.service.js";

type MetricPointsHandlerDeps = {
  metricPointsService: MetricPointsService;
};

/** raw 原始点查询路由：低频 gauge 不聚合、不分桶，按 occurred_at 返回范围内每个原始点。 */
export class MetricPointsHandler {
  private readonly metricPointsService: MetricPointsService;

  public constructor({ metricPointsService }: MetricPointsHandlerDeps) {
    this.metricPointsService = metricPointsService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, metricApiContract.points, ({ input }) =>
      this.metricPointsService.query(input),
    );
  }
}
