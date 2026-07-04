import { describe, expect, it, vi } from "vitest";
import type {
  InnerThoughtDao,
  InnerThoughtSummary,
} from "@kagami/persistence/dao/inner-thought.dao";
import { DefaultInnerThoughtQueryService } from "../../src/ops/application/inner-thought-query.impl.service.js";

function makeDao(overrides: Partial<InnerThoughtDao>): InnerThoughtDao {
  return {
    insert: vi.fn(),
    countByQuery: vi.fn(),
    listPage: vi.fn(),
    ...overrides,
  };
}

describe("DefaultInnerThoughtQueryService", () => {
  it("combines count + page into a paginated response and forwards the outcome filter", async () => {
    const summary: InnerThoughtSummary = {
      id: 1,
      triggeredAt: new Date("2026-07-04T06:00:00.000Z"),
      outcome: "injected",
      thought: "想翻翻那篇文章",
      runtimeKey: "root-agent",
      createdAt: new Date("2026-07-04T06:00:00.000Z"),
    };
    const countByQuery = vi.fn().mockResolvedValue(3);
    const listPage = vi.fn().mockResolvedValue([summary]);
    const service = new DefaultInnerThoughtQueryService({
      innerThoughtDao: makeDao({ countByQuery, listPage }),
    });

    const result = await service.queryList({ page: 1, pageSize: 20, outcome: "injected" });

    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 3 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 1,
      outcome: "injected",
      thought: "想翻翻那篇文章",
    });
    expect(countByQuery).toHaveBeenCalledWith({ page: 1, pageSize: 20, outcome: "injected" });
    expect(listPage).toHaveBeenCalledWith({ page: 1, pageSize: 20, outcome: "injected" });
  });
});
