import type { MainAgentContextSnapshot } from "@kagami/shared/schemas/main-agent-context";
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
}
