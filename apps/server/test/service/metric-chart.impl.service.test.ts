import { describe, expect, it, vi } from "vitest";
import type { MetricChartItem } from "../../src/metric/domain/metric.js";
import { DefaultMetricChartService } from "../../src/metric/application/metric-chart.impl.service.js";
import type { MetricChartDao } from "../../src/metric/infra/metric-chart.dao.js";
import type { MetricDao } from "../../src/metric/infra/metric.dao.js";

describe("DefaultMetricChartService", () => {
  it("should list chart definitions", async () => {
    const service = createService({
      metricChartDao: createMetricChartDao({
        list: vi.fn().mockResolvedValue([
          createMetricChartItem({
            chartName: "总请求量",
            metricName: "http.request",
            aggregator: "count",
          }),
        ]),
      }),
    });

    await expect(service.list()).resolves.toEqual({
      items: [
        {
          chartName: "总请求量",
          metricName: "http.request",
          aggregator: "count",
          tagFilters: null,
          groupByTag: null,
          createdAt: "2026-04-02T00:00:00.000Z",
          updatedAt: "2026-04-02T00:05:00.000Z",
        },
      ],
    });
  });

  it("should create chart definitions and reject duplicates", async () => {
    const create = vi.fn().mockResolvedValue(
      createMetricChartItem({
        chartName: "Token 总量",
        metricName: "llm.token.total",
        aggregator: "sum",
      }),
    );
    const findByChartName = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createMetricChartItem());
    const service = createService({
      metricChartDao: createMetricChartDao({
        create,
        findByChartName,
      }),
    });

    await expect(
      service.create({
        chartName: "  Token 总量  ",
        metricName: "  llm.token.total  ",
        aggregator: "sum",
      }),
    ).resolves.toEqual({
      chart: {
        chartName: "Token 总量",
        metricName: "llm.token.total",
        aggregator: "sum",
        tagFilters: null,
        groupByTag: null,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:05:00.000Z",
      },
    });
    expect(create).toHaveBeenCalledWith({
      chartName: "Token 总量",
      metricName: "llm.token.total",
      aggregator: "sum",
      tagFilters: undefined,
      groupByTag: undefined,
    });

    await expect(
      service.create({
        chartName: "Token 总量",
        metricName: "llm.token.total",
        aggregator: "sum",
      }),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "Metric 图表已存在",
      statusCode: 409,
    });
  });

  it("should delete existing chart definitions and reject missing charts", async () => {
    const deleteByChartName = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const service = createService({
      metricChartDao: createMetricChartDao({
        deleteByChartName,
      }),
    });

    await expect(
      service.delete({
        chartName: "总请求量",
      }),
    ).resolves.toEqual({
      chartName: "总请求量",
      deleted: true,
    });

    await expect(
      service.delete({
        chartName: "missing",
      }),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "Metric 图表不存在",
      statusCode: 404,
    });
  });

  it("should build single-series chart data with missing buckets filled", async () => {
    const metricDao = createMetricDao({
      queryChartSeries: vi.fn().mockResolvedValue([
        {
          bucketStart: new Date("2026-04-02T00:00:00.000Z"),
          seriesKey: null,
          value: 3,
        },
        {
          bucketStart: new Date("2026-04-02T00:02:00.000Z"),
          seriesKey: null,
          value: 1,
        },
      ]),
    });
    const service = createService({
      metricDao,
      metricChartDao: createMetricChartDao({
        findByChartName: vi.fn().mockResolvedValue(
          createMetricChartItem({
            chartName: "总请求量",
            metricName: "http.request",
            aggregator: "count",
          }),
        ),
      }),
    });

    const response = await service.queryData({
      chartName: "总请求量",
      bucket: "1m",
      startAt: "2026-04-02T00:00:10.000Z",
      endAt: "2026-04-02T00:02:10.000Z",
    });

    expect(response.chart.chartName).toBe("总请求量");
    expect(response.series).toEqual([
      {
        key: "__default__",
        label: "总请求量",
        points: [
          {
            bucketStart: "2026-04-02T00:00:00.000Z",
            value: 3,
          },
          {
            bucketStart: "2026-04-02T00:01:00.000Z",
            value: 0,
          },
          {
            bucketStart: "2026-04-02T00:02:00.000Z",
            value: 1,
          },
        ],
      },
    ]);
  });

  it("should build grouped chart data with tag filters and ungrouped labels", async () => {
    const queryChartSeries = vi.fn().mockResolvedValue([
      {
        bucketStart: new Date("2026-04-02T01:00:00.000Z"),
        seriesKey: "gpt-4o",
        value: 120,
      },
      {
        bucketStart: new Date("2026-04-02T01:00:00.000Z"),
        seriesKey: null,
        value: 30,
      },
      {
        bucketStart: new Date("2026-04-02T01:01:00.000Z"),
        seriesKey: "gpt-4o",
        value: 80,
      },
    ]);
    const service = createService({
      metricDao: createMetricDao({
        queryChartSeries,
      }),
      metricChartDao: createMetricChartDao({
        findByChartName: vi.fn().mockResolvedValue(
          createMetricChartItem({
            chartName: "OpenAI 按模型 Token 消耗",
            metricName: "llm.token.total",
            aggregator: "sum",
            tagFilters: {
              provider: "openai",
            },
            groupByTag: "model",
          }),
        ),
      }),
    });

    const response = await service.queryData({
      chartName: "OpenAI 按模型 Token 消耗",
      bucket: "1m",
      startAt: "2026-04-02T01:00:00.000Z",
      endAt: "2026-04-02T01:01:30.000Z",
    });

    expect(queryChartSeries).toHaveBeenCalledWith({
      metricName: "llm.token.total",
      aggregator: "sum",
      tagFilters: {
        provider: "openai",
      },
      groupByTag: "model",
      startAt: new Date("2026-04-02T01:00:00.000Z"),
      endAt: new Date("2026-04-02T01:01:30.000Z"),
      bucket: "1m",
    });
    expect(response.series).toEqual([
      {
        key: "gpt-4o",
        label: "gpt-4o",
        points: [
          {
            bucketStart: "2026-04-02T01:00:00.000Z",
            value: 120,
          },
          {
            bucketStart: "2026-04-02T01:01:00.000Z",
            value: 80,
          },
        ],
      },
      {
        key: "__ungrouped__",
        label: "未分组",
        points: [
          {
            bucketStart: "2026-04-02T01:00:00.000Z",
            value: 30,
          },
          {
            bucketStart: "2026-04-02T01:01:00.000Z",
            value: 0,
          },
        ],
      },
    ]);
  });
});

function createService(overrides?: { metricDao?: MetricDao; metricChartDao?: MetricChartDao }) {
  return new DefaultMetricChartService({
    metricDao: overrides?.metricDao ?? createMetricDao(),
    metricChartDao: overrides?.metricChartDao ?? createMetricChartDao(),
  });
}

function createMetricDao(overrides?: Partial<MetricDao>): MetricDao {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    queryChartSeries: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createMetricChartDao(overrides?: Partial<MetricChartDao>): MetricChartDao {
  return {
    create: vi.fn().mockResolvedValue(createMetricChartItem()),
    findByChartName: vi.fn().mockResolvedValue(null),
    deleteByChartName: vi.fn().mockResolvedValue(false),
    list: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createMetricChartItem(overrides?: Partial<ReturnType<typeof baseMetricChartItem>>) {
  return {
    ...baseMetricChartItem(),
    ...overrides,
  };
}

function baseMetricChartItem(): MetricChartItem {
  return {
    id: 1,
    chartName: "默认图表",
    metricName: "metric.default",
    aggregator: "count",
    tagFilters: null,
    groupByTag: null,
    createdAt: new Date("2026-04-02T00:00:00.000Z"),
    updatedAt: new Date("2026-04-02T00:05:00.000Z"),
  };
}
