import type {
  MainAgentContextCompactionResult,
  MainAgentContextSnapshot,
} from "@kagami/agent-api/main-agent-context";

export interface MainAgentContextQueryService {
  getRecentSnapshot(): Promise<MainAgentContextSnapshot>;
  compactEntireContext(): Promise<MainAgentContextCompactionResult>;
}
