import {
  MetricChartCreateRequestSchema,
  MetricChartCreateResponseSchema,
  MetricChartDataQuerySchema,
  MetricChartDataResponseSchema,
  MetricChartDeleteRequestSchema,
  MetricChartDeleteResponseSchema,
  MetricChartListResponseSchema,
} from "@kagami/shared/schemas/metric-chart";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { registerCommandRoute, registerQueryRoute } from "../../common/http/route.helper.js";
import type { MetricChartService } from "../application/metric-chart.service.js";

const EmptyQuerySchema = z.object({}).strict();

type MetricChartHandlerDeps = {
  metricChartService: MetricChartService;
};

export class MetricChartHandler {
  public readonly prefix = "/metric-chart";
  private readonly metricChartService: MetricChartService;

  public constructor({ metricChartService }: MetricChartHandlerDeps) {
    this.metricChartService = metricChartService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/list`,
      querySchema: EmptyQuerySchema,
      responseSchema: MetricChartListResponseSchema,
      execute: () => this.metricChartService.list(),
    });

    registerQueryRoute({
      app,
      path: `${this.prefix}/data`,
      querySchema: MetricChartDataQuerySchema,
      responseSchema: MetricChartDataResponseSchema,
      execute: ({ query }) => this.metricChartService.queryData(query),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/create`,
      bodySchema: MetricChartCreateRequestSchema,
      responseSchema: MetricChartCreateResponseSchema,
      execute: ({ body }) => this.metricChartService.create(body),
    });

    registerCommandRoute({
      app,
      path: `${this.prefix}/delete`,
      bodySchema: MetricChartDeleteRequestSchema,
      responseSchema: MetricChartDeleteResponseSchema,
      execute: ({ body }) => this.metricChartService.delete(body),
    });
  }
}
