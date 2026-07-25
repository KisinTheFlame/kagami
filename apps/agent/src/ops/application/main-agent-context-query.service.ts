import type {
  MainAgentContextCompactionRequest,
  MainAgentContextCompactionResult,
  MainAgentContextSnapshot,
} from "@kagami/agent-api/main-agent-context";

export interface MainAgentContextQueryService {
  getRecentSnapshot(): Promise<MainAgentContextSnapshot>;
  compactContext(
    input: MainAgentContextCompactionRequest,
  ): Promise<MainAgentContextCompactionResult>;
}
