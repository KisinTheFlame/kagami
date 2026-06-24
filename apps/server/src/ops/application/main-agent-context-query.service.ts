import type {
  MainAgentContextCompactionResult,
  MainAgentContextSnapshot,
} from "@kagami/shared/schemas/main-agent-context";

export interface MainAgentContextQueryService {
  getRecentSnapshot(): Promise<MainAgentContextSnapshot>;
  compactEntireContext(): Promise<MainAgentContextCompactionResult>;
}
