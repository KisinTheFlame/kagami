import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { metricApiContract } from "@kagami/metric-api/contract";
import type { MetricDeriveService } from "../application/metric-derive.service.js";

type MetricDeriveHandlerDeps = {
  metricDeriveService: MetricDeriveService;
};

/** 派生查询路由（#475 P3）：分子/分母两份规格算 ratio/diff，出单条派生线。 */
export class MetricDeriveHandler {
  private readonly metricDeriveService: MetricDeriveService;

  public constructor({ metricDeriveService }: MetricDeriveHandlerDeps) {
    this.metricDeriveService = metricDeriveService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, metricApiContract.derive, ({ input }) =>
      this.metricDeriveService.derive(input),
    );
  }
}
