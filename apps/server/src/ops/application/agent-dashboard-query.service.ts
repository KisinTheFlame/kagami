import type { AgentDashboardSnapshot } from "@kagami/shared/schemas/agent-dashboard";

export interface AgentDashboardQueryService {
  getCurrentSnapshot(): Promise<AgentDashboardSnapshot>;
}
