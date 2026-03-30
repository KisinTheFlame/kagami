import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AgentDashboardResetContextResponseSchema,
  AgentDashboardSnapshotSchema,
} from "@kagami/shared/schemas/agent-dashboard";
import { registerCommandRoute, registerQueryRoute } from "../../common/http/route.helper.js";
import type { AgentDashboardCommandService } from "../application/agent-dashboard-command.service.js";
import type { AgentDashboardQueryService } from "../application/agent-dashboard-query.service.js";

type AgentDashboardHandlerDeps = {
  agentDashboardQueryService: AgentDashboardQueryService;
  agentDashboardCommandService: AgentDashboardCommandService;
};

export class AgentDashboardHandler {
  public readonly prefix = "/agent-dashboard";
  private readonly agentDashboardQueryService: AgentDashboardQueryService;
  private readonly agentDashboardCommandService: AgentDashboardCommandService;

  public constructor({
    agentDashboardQueryService,
    agentDashboardCommandService,
  }: AgentDashboardHandlerDeps) {
    this.agentDashboardQueryService = agentDashboardQueryService;
    this.agentDashboardCommandService = agentDashboardCommandService;
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

    registerCommandRoute({
      app,
      path: `${this.prefix}/reset-context`,
      bodySchema: z.object({}).strict(),
      responseSchema: AgentDashboardResetContextResponseSchema,
      execute: async () => {
        return await this.agentDashboardCommandService.resetContext();
      },
    });
  }
}
