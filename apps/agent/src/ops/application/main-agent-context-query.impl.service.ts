import type {
  MainAgentContextCompactionResult,
  MainAgentContextSnapshot,
} from "@kagami/agent-api/main-agent-context";
import type { RootLoopAgent } from "../../agent/runtime/root-agent/root-agent-runtime.js";
import type { MainAgentContextQueryService } from "./main-agent-context-query.service.js";

type DefaultMainAgentContextQueryServiceDeps = {
  rootAgentRuntime: RootLoopAgent;
};

export class DefaultMainAgentContextQueryService implements MainAgentContextQueryService {
  private readonly rootAgentRuntime: RootLoopAgent;

  public constructor({ rootAgentRuntime }: DefaultMainAgentContextQueryServiceDeps) {
    this.rootAgentRuntime = rootAgentRuntime;
  }

  public async getRecentSnapshot(): Promise<MainAgentContextSnapshot> {
    const summary = await this.rootAgentRuntime.getRecentContextSummary();
    return {
      generatedAt: new Date().toISOString(),
      recentItems: summary.recentItems,
      recentItemsTruncated: summary.recentItemsTruncated,
    };
  }

  public async compactEntireContext(): Promise<MainAgentContextCompactionResult> {
    const result = await this.rootAgentRuntime.compactEntireContext();
    return {
      compacted: result.compacted,
      compactedAt: result.compactedAt.toISOString(),
    };
  }
}
