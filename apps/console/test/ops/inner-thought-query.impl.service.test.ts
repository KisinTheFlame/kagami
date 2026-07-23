import { describe, expect, it, vi } from "vitest";
import type { AgentInnerThoughtWireItem } from "@kagami/agent-api/ops-query";
import { DefaultInnerThoughtQueryService } from "../../src/ops/application/inner-thought-query.impl.service.js";
import type { AgentOpsQueryClient } from "../../src/ops/application/app-log-query.impl.service.js";

function makeClient(overrides: Partial<AgentOpsQueryClient>): AgentOpsQueryClient {
  return {
    queryAppLogs: vi.fn(),
    queryInnerThoughts: vi.fn(),
    queryTodos: vi.fn(),
    ...overrides,
  };
}

describe("DefaultInnerThoughtQueryService", () => {
  it("combines total + items into a paginated response and forwards the outcome filter", async () => {
    const item: AgentInnerThoughtWireItem = {
      id: 1,
      triggeredAt: "2026-07-04T06:00:00.000Z",
      outcome: "injected",
      thought: "想翻翻那篇文章",
      runtimeKey: "root-agent",
      createdAt: "2026-07-04T06:00:00.000Z",
    };
    const queryInnerThoughts = vi.fn().mockResolvedValue({ total: 3, items: [item] });
    const service = new DefaultInnerThoughtQueryService({
      agentOpsQueryClient: makeClient({ queryInnerThoughts }),
    });

    const result = await service.queryList({ page: 1, pageSize: 20, outcome: "injected" });

    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 3 });
    expect(result.items).toEqual([item]);
    expect(queryInnerThoughts).toHaveBeenCalledWith({
      outcome: "injected",
      page: 1,
      pageSize: 20,
    });
  });
});
