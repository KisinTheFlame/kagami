import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { metricApiContract } from "@kagami/metric-api/contract";
import type { LlmObservabilityService } from "../application/llm-observability.service.js";

type ObservabilityHandlerDeps = {
  llmObservabilityService: LlmObservabilityService;
};

/** LLM 行为观察台查询路由。路由与 schema 单一事实源在 @kagami/metric-api。 */
export class ObservabilityHandler {
  private readonly llmObservabilityService: LlmObservabilityService;

  public constructor({ llmObservabilityService }: ObservabilityHandlerDeps) {
    this.llmObservabilityService = llmObservabilityService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, metricApiContract.llmOverview, ({ input }) =>
      this.llmObservabilityService.overview(input),
    );

    registerJsonRoute(app, metricApiContract.llmTimeseries, ({ input }) =>
      this.llmObservabilityService.timeseries(input),
    );
  }
}
