import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { metricApiContract } from "@kagami/metric-api/contract";
import type { MetricChartService } from "../application/metric-chart.service.js";

type MetricChartHandlerDeps = {
  metricChartService: MetricChartService;
};

/** 图表查数路由。图表定义已迁回代码（#444），入参是内联聚合规格，无 chartName / CRUD。 */
export class MetricChartHandler {
  private readonly metricChartService: MetricChartService;

  public constructor({ metricChartService }: MetricChartHandlerDeps) {
    this.metricChartService = metricChartService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, metricApiContract.query, ({ input }) =>
      this.metricChartService.query(input),
    );
  }
}
