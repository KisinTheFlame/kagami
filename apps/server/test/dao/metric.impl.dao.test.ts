import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../src/db/client.js";
import { PrismaMetricDao } from "../../src/metric/infra/impl/prisma-metric.impl.dao.js";
import { PrismaMetricChartDao } from "../../src/metric/infra/impl/prisma-metric-chart.impl.dao.js";

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
    const queryRaw = vi.fn().mockResolvedValue([
      {
        bucketStart: new Date("2026-04-02T00:00:00.000Z"),
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

describe("PrismaMetricChartDao", () => {
  it("should create and map metric chart rows", async () => {
    const createdAt = new Date("2026-04-01T12:00:00.000Z");
    const updatedAt = new Date("2026-04-01T12:05:00.000Z");
    const create = vi.fn().mockResolvedValue({
      id: 1,
      chartName: "总请求量",
      metricName: "llm.token.total",
      aggregator: "sum",
      tagFilters: null,
      groupByTag: null,
      createdAt,
      updatedAt,
    });
    const database = {
      metricChart: {
        create,
      },
    } as unknown as Database;

    const dao = new PrismaMetricChartDao({ database });

    await expect(
      dao.create({
        chartName: "总请求量",
        metricName: "llm.token.total",
        aggregator: "sum",
      }),
    ).resolves.toEqual({
      id: 1,
      chartName: "总请求量",
      metricName: "llm.token.total",
      aggregator: "sum",
      tagFilters: null,
      groupByTag: null,
      createdAt,
      updatedAt,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        chartName: "总请求量",
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: undefined,
        groupByTag: null,
      },
    });
  });

  it("should query metric charts by chart name and list them", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        id: 2,
        chartName: "OpenAI 按模型 Token 消耗",
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: {
          provider: "openai",
        },
        groupByTag: "model",
        createdAt: new Date("2026-04-01T13:00:00.000Z"),
        updatedAt: new Date("2026-04-01T13:10:00.000Z"),
      })
      .mockResolvedValueOnce({
        id: 3,
        chartName: "Token 总量",
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: null,
        groupByTag: null,
        createdAt: new Date("2026-04-01T14:00:00.000Z"),
        updatedAt: new Date("2026-04-01T14:10:00.000Z"),
      })
      .mockResolvedValueOnce(null);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 2,
        chartName: "OpenAI 按模型 Token 消耗",
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: {
          provider: "openai",
        },
        groupByTag: "model",
        createdAt: new Date("2026-04-01T13:00:00.000Z"),
        updatedAt: new Date("2026-04-01T13:10:00.000Z"),
      },
      {
        id: 3,
        chartName: "Token 总量",
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: null,
        groupByTag: null,
        createdAt: new Date("2026-04-01T14:00:00.000Z"),
        updatedAt: new Date("2026-04-01T14:10:00.000Z"),
      },
    ]);
    const database = {
      metricChart: {
        findUnique,
        findMany,
      },
    } as unknown as Database;

    const dao = new PrismaMetricChartDao({ database });

    await expect(dao.findByChartName("OpenAI 按模型 Token 消耗")).resolves.toMatchObject({
      chartName: "OpenAI 按模型 Token 消耗",
      metricName: "llm.token.total",
      aggregator: "sum",
      tagFilters: {
        provider: "openai",
      },
      groupByTag: "model",
    });
    await expect(dao.findByChartName("Token 总量")).resolves.toMatchObject({
      chartName: "Token 总量",
      metricName: "llm.token.total",
      aggregator: "sum",
    });
    await expect(dao.findByChartName("missing.chart")).resolves.toBeNull();
    await expect(dao.list()).resolves.toMatchObject([
      {
        chartName: "OpenAI 按模型 Token 消耗",
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: {
          provider: "openai",
        },
        groupByTag: "model",
      },
      {
        chartName: "Token 总量",
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: null,
        groupByTag: null,
      },
    ]);

    expect(findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        chartName: "OpenAI 按模型 Token 消耗",
      },
    });
    expect(findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        chartName: "Token 总量",
      },
    });
    expect(findUnique).toHaveBeenNthCalledWith(3, {
      where: {
        chartName: "missing.chart",
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ chartName: "asc" }, { id: "asc" }],
    });
  });

  it("should delete metric charts by chart name", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      metricChart: {
        deleteMany,
      },
    } as unknown as Database;

    const dao = new PrismaMetricChartDao({ database });

    await expect(dao.deleteByChartName("总请求量")).resolves.toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        chartName: "总请求量",
      },
    });
  });
});
