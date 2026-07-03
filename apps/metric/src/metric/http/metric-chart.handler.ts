import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { metricApiContract } from "@kagami/metric-api/contract";
import type { MetricChartService } from "../application/metric-chart.service.js";

type MetricChartHandlerDeps = {
  metricChartService: MetricChartService;
};

/** 图表定义 / 查数路由。路由与 schema 的单一事实源在 @kagami/metric-api（#279 PR3）。 */
export class MetricChartHandler {
  private readonly metricChartService: MetricChartService;

  public constructor({ metricChartService }: MetricChartHandlerDeps) {
    this.metricChartService = metricChartService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, metricApiContract.listCharts, () => this.metricChartService.list());

    registerJsonRoute(app, metricApiContract.chartData, ({ input }) =>
      this.metricChartService.queryData(input),
    );

    registerJsonRoute(app, metricApiContract.createChart, ({ input }) =>
      this.metricChartService.create(input),
    );

    registerJsonRoute(app, metricApiContract.deleteChart, ({ input }) =>
      this.metricChartService.delete(input),
    );
  }
}
