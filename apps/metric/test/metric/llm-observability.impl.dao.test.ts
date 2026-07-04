import { describe, expect, it, vi } from "vitest";
import type { Database } from "@kagami/persistence/db/client";
import { PrismaLlmObservabilityDao } from "@kagami/persistence/dao/impl/prisma-llm-observability.impl.dao";

const RANGE = {
  from: new Date("2026-01-01T00:00:00.000Z"),
  to: new Date("2026-01-01T01:00:00.000Z"),
};

describe("PrismaLlmObservabilityDao.overviewStats", () => {
  it("maps aggregate row + separate p95 row, coercing SQLite scalars", async () => {
    // 第一次 $queryRaw 是概览标量行，第二次是 p95 单行。SQLite 可能回 bigint / string。
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        {
          totalCalls: 200n,
          errorCount: 10n,
          latencyAvgMs: "123.5",
          promptTokens: 1000n,
          completionTokens: 500n,
          totalTokens: 1500n,
          cacheHitTokens: 800n,
          cacheMissTokens: 200n,
        },
      ])
      .mockResolvedValueOnce([{ p95: 900n }]);
    const database = { $queryRaw: queryRaw } as unknown as Database;

    const dao = new PrismaLlmObservabilityDao({ database });
    const stats = await dao.overviewStats(RANGE);

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(stats).toEqual({
      totalCalls: 200,
      errorCount: 10,
      latencyAvgMs: 123.5,
      latencyP95Ms: 900,
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cacheHitTokens: 800,
      cacheMissTokens: 200,
    });
  });

  it("returns null p95 when there is no latency sample (empty p95 row)", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        {
          totalCalls: 0n,
          errorCount: 0n,
          latencyAvgMs: null,
          promptTokens: 0n,
          completionTokens: 0n,
          totalTokens: 0n,
          cacheHitTokens: 0n,
          cacheMissTokens: 0n,
        },
      ])
      .mockResolvedValueOnce([]);
    const database = { $queryRaw: queryRaw } as unknown as Database;

    const dao = new PrismaLlmObservabilityDao({ database });
    const stats = await dao.overviewStats(RANGE);

    expect(stats.latencyAvgMs).toBeNull();
    expect(stats.latencyP95Ms).toBeNull();
    expect(stats.totalCalls).toBe(0);
  });
});

describe("PrismaLlmObservabilityDao.timeseries", () => {
  it("converts epoch-second bucketStart back to Date and coerces value", async () => {
    const bucketEpochSeconds = new Date("2026-01-01T00:05:00.000Z").getTime() / 1000;
    const queryRaw = vi
      .fn()
      .mockResolvedValue([{ bucketStart: bucketEpochSeconds, seriesKey: "gpt-5.5", value: 7n }]);
    const database = { $queryRaw: queryRaw } as unknown as Database;

    const dao = new PrismaLlmObservabilityDao({ database });
    const rows = await dao.timeseries({
      range: RANGE,
      bucket: "5m",
      metric: "calls",
      groupBy: "model",
    });

    expect(rows).toEqual([
      {
        bucketStart: new Date("2026-01-01T00:05:00.000Z"),
        seriesKey: "gpt-5.5",
        value: 7,
      },
    ]);
  });
});
