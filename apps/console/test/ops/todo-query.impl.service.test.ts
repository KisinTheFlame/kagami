import { describe, expect, it, vi } from "vitest";
import type { AgentTodoWireItem } from "@kagami/agent-api/ops-query";
import { DefaultTodoQueryService } from "../../src/ops/application/todo-query.impl.service.js";
import type { AgentOpsQueryClient } from "../../src/ops/application/app-log-query.impl.service.js";

function makeClient(overrides: Partial<AgentOpsQueryClient>): AgentOpsQueryClient {
  return {
    queryAppLogs: vi.fn(),
    queryInnerThoughts: vi.fn(),
    queryTodos: vi.fn(),
    ...overrides,
  };
}

const sampleItem: AgentTodoWireItem = {
  id: 1,
  title: "写周报",
  note: null,
  status: "pending",
  remindAt: null,
  repeatEveryMs: null,
  snoozedUntil: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  completedAt: null,
};

describe("DefaultTodoQueryService", () => {
  it("queryList should assemble total + items into a paginated response", async () => {
    const queryTodos = vi.fn().mockResolvedValue({ total: 3, items: [sampleItem] });
    const service = new DefaultTodoQueryService({
      agentOpsQueryClient: makeClient({ queryTodos }),
    });

    const result = await service.queryList({ page: 1, pageSize: 20, status: undefined });

    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 3 });
    expect(result.items).toEqual([sampleItem]);
  });

  it("queryList should forward status filter to the client", async () => {
    const queryTodos = vi.fn().mockResolvedValue({ total: 0, items: [] });
    const service = new DefaultTodoQueryService({
      agentOpsQueryClient: makeClient({ queryTodos }),
    });

    await service.queryList({ page: 2, pageSize: 20, status: "completed" });

    expect(queryTodos).toHaveBeenCalledWith({ status: "completed", page: 2, pageSize: 20 });
  });
});
