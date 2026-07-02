import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";
import type { LlmPlaygroundService } from "../application/llm-playground.service.js";

type LlmHandlerDeps = {
  llmPlaygroundService: LlmPlaygroundService;
};

/** Playground（管理台 LLM 调试）路由。路由与 schema 的单一事实源在 @kagami/agent-api（#279 PR5）。 */
export class LlmHandler {
  private readonly llmPlaygroundService: LlmPlaygroundService;

  public constructor({ llmPlaygroundService }: LlmHandlerDeps) {
    this.llmPlaygroundService = llmPlaygroundService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, agentApiContract.listProviders, () => {
      return this.llmPlaygroundService.listProviders();
    });

    registerJsonRoute(app, agentApiContract.listPlaygroundTools, () => {
      return this.llmPlaygroundService.listPlaygroundTools();
    });

    registerJsonRoute(app, agentApiContract.playgroundChat, ({ input }) => {
      return this.llmPlaygroundService.chat(input);
    });
  }
}
