import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";
import type { LlmProviderService } from "../application/llm-provider.service.js";

type LlmHandlerDeps = {
  llmProviderService: LlmProviderService;
};

/** LLM provider 列举路由（管理台「LLM 调用历史」按 provider 过滤用）。路由与 schema 的单一事实源在 @kagami/agent-api（#279 PR5）。 */
export class LlmHandler {
  private readonly llmProviderService: LlmProviderService;

  public constructor({ llmProviderService }: LlmHandlerDeps) {
    this.llmProviderService = llmProviderService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, agentApiContract.listProviders, () => {
      return this.llmProviderService.listProviders();
    });
  }
}
