import { describe, expect, it, vi } from "vitest";
import type { Database } from "@kagami/persistence/db/client";
import { PrismaMetricDao } from "@kagami/persistence/dao/impl/prisma-metric.impl.dao";

describe("PrismaMetricDao", () => {
  it("should persist metric rows", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const database = {
      metric: {
        create,
      },
    } as unknown as Database;

    const dao = new PrismaMetricDao({ database });
    const occurredAt = new Date("2026-04-01T12:00:00.000Z");

    await dao.insert({
      metricName: "llm.token.total",
      value: 42,
      tags: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
      occurredAt,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        metricName: "llm.token.total",
        value: 42,
        tags: {
          provider: "openai",
          model: "gpt-4o-mini",
        },
        occurredAt,
      },
    });
  });

  it("should persist empty tags and optional occurredAt", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const database = {
      metric: {
        create,
      },
    } as unknown as Database;

    const dao = new PrismaMetricDao({ database });

    await dao.insert({
      metricName: "http.request.count",
      value: 1,
      tags: {},
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        metricName: "http.request.count",
        value: 1,
        tags: {},
        occurredAt: undefined,
      },
    });
  });

  it("should map aggregated chart series rows", async () => {
    // SQLite 下 unixepoch 分桶返回 epoch 秒（整数），DAO 负责转回 Date。
    const bucketStartEpochSeconds = new Date("2026-04-02T00:00:00.000Z").getTime() / 1000;
    const queryRaw = vi.fn().mockResolvedValue([
      {
        bucketStart: bucketStartEpochSeconds,
        seriesKey: "gpt-4o",
        value: 120,
      },
    ]);
    const database = {
      metric: {
        create: vi.fn(),
      },
      $queryRaw: queryRaw,
    } as unknown as Database;

    const dao = new PrismaMetricDao({ database });

    await expect(
      dao.queryChartSeries({
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: {
          provider: "openai",
        },
        groupByTag: "model",
        startAt: new Date("2026-04-02T00:00:00.000Z"),
        endAt: new Date("2026-04-02T01:00:00.000Z"),
        bucket: "1m",
      }),
    ).resolves.toEqual([
      {
        bucketStart: new Date("2026-04-02T00:00:00.000Z"),
        seriesKey: "gpt-4o",
        value: 120,
      },
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
