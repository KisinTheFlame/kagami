import type { AgentDashboardResetContextResponse } from "@kagami/shared/schemas/agent-dashboard";

export interface AgentDashboardCommandService {
  resetContext(): Promise<AgentDashboardResetContextResponse>;
}
