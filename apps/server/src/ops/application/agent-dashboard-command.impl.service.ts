import type { AgentDashboardResetContextResponse } from "@kagami/shared/schemas/agent-dashboard";
import type { RootAgentRuntime } from "../../agent/runtime/root-agent/root-agent-runtime.js";
import type { AgentDashboardCommandService } from "./agent-dashboard-command.service.js";

type DefaultAgentDashboardCommandServiceDeps = {
  rootAgentRuntime: Pick<RootAgentRuntime, "resetContext">;
};

export class DefaultAgentDashboardCommandService implements AgentDashboardCommandService {
  private readonly rootAgentRuntime: Pick<RootAgentRuntime, "resetContext">;

  public constructor({ rootAgentRuntime }: DefaultAgentDashboardCommandServiceDeps) {
    this.rootAgentRuntime = rootAgentRuntime;
  }

  public async resetContext(): Promise<AgentDashboardResetContextResponse> {
    const result = await this.rootAgentRuntime.resetContext();
    return {
      ok: true,
      resetAt: result.resetAt.toISOString(),
    };
  }
}
