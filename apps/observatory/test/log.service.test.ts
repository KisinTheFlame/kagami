import { describe, expect, it, vi } from "vitest";
import type {
  AppLogItem,
  InsertAppLogItem,
  LogDao,
  QueryAppLogListFilterInput,
  QueryAppLogListPageInput,
} from "@kagami/kernel/logger/dao/log.dao";
import { LogService } from "../src/application/log.service.js";

function makeDao(overrides: Partial<LogDao> = {}): LogDao {
  return {
    insertBatch: vi.fn<(items: InsertAppLogItem[]) => Promise<void>>().mockResolvedValue(undefined),
    countByQuery: vi
      .fn<(input: QueryAppLogListFilterInput) => Promise<number>>()
      .mockResolvedValue(0),
    listByQueryPage: vi
      .fn<(input: QueryAppLogListPageInput) => Promise<AppLogItem[]>>()
      .mockResolvedValue([]),
    deleteOlderThan: vi.fn<(threshold: Date) => Promise<number>>().mockResolvedValue(0),
    ...overrides,
  };
}

describe("LogService.ingest", () => {
  it("把 wire item 落成 DAO 行：service 提到每一行，createdAt 由 ISO 还原成 Date", async () => {
    const insertBatch = vi.fn().mockResolvedValue(undefined);
    const service = new LogService({ logDao: makeDao({ insertBatch }) });

    const result = await service.ingest({
      service: "napcat",
      items: [
        {
          traceId: "trace-1",
          level: "warn",
          message: "boom",
          metadata: { source: "napcat.gateway" },
          createdAt: "2026-07-29T00:00:00.000Z",
        },
        {
          traceId: "trace-2",
          level: "info",
          message: "",
          metadata: {},
          createdAt: "2026-07-29T00:00:01.000Z",
        },
      ],
    });

    expect(result).toEqual({ accepted: 2 });
    expect(insertBatch).toHaveBeenCalledWith([
      {
        service: "napcat",
        traceId: "trace-1",
        level: "warn",
        message: "boom",
        metadata: { source: "napcat.gateway" },
        createdAt: new Date("2026-07-29T00:00:00.000Z"),
      },
      {
        service: "napcat",
        traceId: "trace-2",
        level: "info",
        message: "",
        metadata: {},
        createdAt: new Date("2026-07-29T00:00:01.000Z"),
      },
    ]);
  });
});

describe("LogService.query", () => {
  it("分页参数与过滤条件分开下发，Date 序列化成 ISO", async () => {
    const countByQuery = vi.fn().mockResolvedValue(42);
    const listByQueryPage = vi.fn().mockResolvedValue([
      {
        id: 7,
        service: "agent",
        traceId: "trace-9",
        level: "error",
        message: "kaboom",
        metadata: { source: "agent.root" },
        createdAt: new Date("2026-07-29T02:03:04.000Z"),
      } satisfies AppLogItem,
    ]);
    const service = new LogService({ logDao: makeDao({ countByQuery, listByQueryPage }) });

    const result = await service.query({
      service: "agent",
      level: "error",
      page: 2,
      pageSize: 20,
    });

    // 计数只吃过滤条件，不该带上 page/pageSize
    expect(countByQuery).toHaveBeenCalledWith({ service: "agent", level: "error" });
    expect(listByQueryPage).toHaveBeenCalledWith({
      service: "agent",
      level: "error",
      page: 2,
      pageSize: 20,
    });
    expect(result).toEqual({
      total: 42,
      items: [
        {
          id: 7,
          service: "agent",
          traceId: "trace-9",
          level: "error",
          message: "kaboom",
          metadata: { source: "agent.root" },
          createdAt: "2026-07-29T02:03:04.000Z",
        },
      ],
    });
  });
});
