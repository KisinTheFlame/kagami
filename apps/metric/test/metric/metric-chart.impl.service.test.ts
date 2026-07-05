import { describe, expect, it, vi } from "vitest";
import { DefaultMetricChartService } from "../../src/metric/application/metric-chart.impl.service.js";
import type { MetricChartSeriesRow, MetricDao } from "../../src/metric/infra/metric.dao.js";

describe("DefaultMetricChartService", () => {
  it("should build single-series chart data with missing buckets filled", async () => {
    const metricDao = createMetricDao({
      queryChartSeries: vi.fn().mockResolvedValue([
        { bucketStart: new Date("2026-04-02T00:00:00.000Z"), seriesKey: null, value: 3 },
        { bucketStart: new Date("2026-04-02T00:02:00.000Z"), seriesKey: null, value: 1 },
      ]),
    });
    const service = new DefaultMetricChartService({ metricDao });

    const response = await service.query({
      metricName: "http.request",
      aggregator: "count",
      bucket: "1m",
      startAt: "2026-04-02T00:00:10.000Z",
      endAt: "2026-04-02T00:02:10.000Z",
    });

    expect(response.bucket).toBe("1m");
    expect(response.series).toEqual([
      {
        key: "__default__",
        label: "http.request",
        points: [
          { bucketStart: "2026-04-02T00:00:00.000Z", value: 3 },
          { bucketStart: "2026-04-02T00:01:00.000Z", value: 0 },
          { bucketStart: "2026-04-02T00:02:00.000Z", value: 1 },
        ],
      },
    ]);
  });

  it("should pass the inline spec straight to the DAO and build grouped series", async () => {
    const queryChartSeries = vi.fn().mockResolvedValue([
      { bucketStart: new Date("2026-04-02T01:00:00.000Z"), seriesKey: "gpt-4o", value: 120 },
      { bucketStart: new Date("2026-04-02T01:00:00.000Z"), seriesKey: null, value: 30 },
      { bucketStart: new Date("2026-04-02T01:01:00.000Z"), seriesKey: "gpt-4o", value: 80 },
    ]);
    const service = new DefaultMetricChartService({
      metricDao: createMetricDao({ queryChartSeries }),
    });

    const response = await service.query({
      metricName: "llm.token.total",
      aggregator: "sum",
      bucket: "1m",
      tagFilters: { provider: "openai" },
      groupByTag: "model",
      startAt: "2026-04-02T01:00:00.000Z",
      endAt: "2026-04-02T01:01:30.000Z",
    });

    expect(queryChartSeries).toHaveBeenCalledWith({
      metricName: "llm.token.total",
      aggregator: "sum",
      tagFilters: { provider: "openai" },
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
          { bucketStart: "2026-04-02T01:00:00.000Z", value: 120 },
          { bucketStart: "2026-04-02T01:01:00.000Z", value: 80 },
        ],
      },
      {
        key: "__ungrouped__",
        label: "未分组",
        points: [
          { bucketStart: "2026-04-02T01:00:00.000Z", value: 30 },
          { bucketStart: "2026-04-02T01:01:00.000Z", value: 0 },
        ],
      },
    ]);
  });

  it("should default null tagFilters/groupByTag when omitted", async () => {
    const queryChartSeries = vi.fn().mockResolvedValue([]);
    const service = new DefaultMetricChartService({
      metricDao: createMetricDao({ queryChartSeries }),
    });

    await service.query({
      metricName: "agent.tool.call",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
    });

    expect(queryChartSeries).toHaveBeenCalledWith(
      expect.objectContaining({ tagFilters: null, groupByTag: null }),
    );
  });

  it("should return an empty series list when the DAO yields no rows", async () => {
    const service = new DefaultMetricChartService({
      metricDao: createMetricDao({ queryChartSeries: vi.fn().mockResolvedValue([]) }),
    });

    const response = await service.query({
      metricName: "http.request",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
    });

    expect(response.series).toEqual([]);
  });

  it("should cap grouped series to the top 20 by magnitude", async () => {
    // 25 个分组，各占 1 个桶，总量 = 序号；期望保留总量最大的前 20 个（6..30）。
    const bucketStart = new Date("2026-04-02T00:00:00.000Z");
    const rows: MetricChartSeriesRow[] = Array.from({ length: 25 }, (_unused, index) => ({
      bucketStart,
      seriesKey: `series-${index + 1}`,
      value: index + 6,
    }));
    const service = new DefaultMetricChartService({
      metricDao: createMetricDao({ queryChartSeries: vi.fn().mockResolvedValue(rows) }),
    });

    const response = await service.query({
      metricName: "http.request",
      aggregator: "count",
      bucket: "1m",
      groupByTag: "path",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:00:30.000Z",
    });

    expect(response.series).toHaveLength(20);
    const totals = response.series.map(series => series.points[0]?.value ?? 0);
    expect(Math.min(...(totals as number[]))).toBe(11); // 30..11 保留，10..6 被裁
    expect(response.series.some(series => series.key === "series-1")).toBe(false);
  });
});

function createMetricDao(overrides?: Partial<MetricDao>): MetricDao {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    queryChartSeries: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
    ...overrides,
  };
}
