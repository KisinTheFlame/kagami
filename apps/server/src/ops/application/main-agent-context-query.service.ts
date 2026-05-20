import type { MainAgentContextSnapshot } from "@kagami/shared/schemas/main-agent-context";

export interface MainAgentContextQueryService {
  getRecentSnapshot(): Promise<MainAgentContextSnapshot>;
}
