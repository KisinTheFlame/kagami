import { describe, expect, it, vi } from "vitest";
import type { RootLoopAgent } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { DefaultMainAgentContextQueryService } from "../../src/ops/application/main-agent-context-query.impl.service.js";

describe("DefaultMainAgentContextQueryService", () => {
  it("should return the main agent recent context summary", async () => {
    const rootAgentRuntime: Pick<RootLoopAgent, "getRecentContextSummary"> = {
      getRecentContextSummary: vi.fn().mockResolvedValue({
        messageCount: 12,
        recentItems: [
          {
            kind: "llm_message",
            label: "用户消息",
            preview: "最近一条消息",
            truncated: false,
          },
        ],
        recentItemsTruncated: true,
      }),
    };
    const service = new DefaultMainAgentContextQueryService({
      rootAgentRuntime: rootAgentRuntime as RootLoopAgent,
    });

    const snapshot = await service.getRecentSnapshot();

    expect(snapshot.recentItems).toEqual([
      {
        kind: "llm_message",
        label: "用户消息",
        preview: "最近一条消息",
        truncated: false,
      },
    ]);
    expect(snapshot.recentItemsTruncated).toBe(true);
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
