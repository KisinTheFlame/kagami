import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AgentDashboardSnapshotSchema } from "@kagami/shared/schemas/agent-dashboard";
import { registerQueryRoute } from "../../common/http/route.helper.js";
import type { AgentDashboardQueryService } from "../application/agent-dashboard-query.service.js";

type AgentDashboardHandlerDeps = {
  agentDashboardQueryService: AgentDashboardQueryService;
};

export class AgentDashboardHandler {
  public readonly prefix = "/agent-dashboard";
  private readonly agentDashboardQueryService: AgentDashboardQueryService;

  public constructor({ agentDashboardQueryService }: AgentDashboardHandlerDeps) {
    this.agentDashboardQueryService = agentDashboardQueryService;
  }

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/current`,
      querySchema: z.object({}).strict(),
      responseSchema: AgentDashboardSnapshotSchema,
      execute: async () => {
        return await this.agentDashboardQueryService.getCurrentSnapshot();
      },
    });
  }
}
