import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { agentApiContract } from "@kagami/agent-api/contract";
import type { MainAgentContextQueryService } from "../application/main-agent-context-query.service.js";

type MainAgentContextHandlerDeps = {
  mainAgentContextQueryService: MainAgentContextQueryService;
};

/** 主 Agent 上下文查询/压缩路由。路由与 schema 的单一事实源在 @kagami/agent-api（#279 PR5）。 */
export class MainAgentContextHandler {
  private readonly mainAgentContextQueryService: MainAgentContextQueryService;

  public constructor({ mainAgentContextQueryService }: MainAgentContextHandlerDeps) {
    this.mainAgentContextQueryService = mainAgentContextQueryService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, agentApiContract.getRecentMainAgentContext, async () => {
      return await this.mainAgentContextQueryService.getRecentSnapshot();
    });

    registerJsonRoute(app, agentApiContract.compactMainAgentContext, async () => {
      return await this.mainAgentContextQueryService.compactEntireContext();
    });
  }
}
