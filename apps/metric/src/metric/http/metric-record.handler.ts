import {
  RecordMetricRequestSchema,
  RecordMetricResponseSchema,
} from "@kagami/shared/schemas/metric";
import type { FastifyInstance } from "fastify";
import { registerCommandRoute } from "@kagami/http/route";
import type { MetricRecordService } from "../application/metric-record.service.js";

type MetricRecordHandlerDeps = {
  metricRecordService: MetricRecordService;
};

export class MetricRecordHandler {
  public readonly prefix = "/metric";
  private readonly metricRecordService: MetricRecordService;

  public constructor({ metricRecordService }: MetricRecordHandlerDeps) {
    this.metricRecordService = metricRecordService;
  }

  public register(app: FastifyInstance): void {
    registerCommandRoute({
      app,
      path: `${this.prefix}/record`,
      bodySchema: RecordMetricRequestSchema,
      responseSchema: RecordMetricResponseSchema,
      execute: async ({ body }) => {
        await this.metricRecordService.record(body);
        return { ok: true as const };
      },
    });
  }
}
