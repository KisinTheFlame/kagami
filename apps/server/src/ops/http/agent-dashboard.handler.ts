import type { FastifyInstance } from "fastify";
import { AgentDashboardSnapshotSchema } from "@kagami/shared/schemas/agent-dashboard";
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
    app.get(`${this.prefix}/current`, async () => {
      const snapshot = await this.agentDashboardQueryService.getCurrentSnapshot();
      return AgentDashboardSnapshotSchema.parse(snapshot);
    });
  }
}
