import { describe, expect, it, vi } from "vitest";
import type { MetricDao, MetricDerivedSeriesRow } from "../../src/metric/infra/metric.dao.js";
import { DefaultMetricDeriveService } from "../../src/metric/application/metric-derive.impl.service.js";

// 派生服务纵切片：真实 buildSeries 补桶逻辑 + 打桩 DAO。验证 DAO 的每桶派生值被填进完整桶轴、
// 缺桶补 null、出单条派生线。

function createMetricDao(overrides?: Partial<MetricDao>): MetricDao {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    queryChartSeries: vi.fn().mockResolvedValue([]),
    queryDerivedSeries: vi.fn().mockResolvedValue([]),
    queryRawPoints: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
    ...overrides,
  };
}

describe("DefaultMetricDeriveService", () => {
  it("fills the full bucket axis and leaves gaps null as one derived series", async () => {
    const rows: MetricDerivedSeriesRow[] = [
      { bucketStart: new Date("2026-04-02T00:00:00.000Z"), value: 0.4 },
      // 10:01 桶缺（DAO 未返回）→ 应补 null
      { bucketStart: new Date("2026-04-02T00:02:00.000Z"), value: null }, // divzero → null
    ];
    const queryDerivedSeries = vi.fn().mockResolvedValue(rows);
    const service = new DefaultMetricDeriveService({
      metricDao: createMetricDao({ queryDerivedSeries }),
    });

    const response = await service.derive({
      numerator: { metricName: "agent.tool.call", aggregator: "count" },
      denominator: { metricName: "agent.tool.call", aggregator: "count" },
      op: "ratio",
      bucket: "1m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:02:30.000Z",
    });

    expect(response.series).toHaveLength(1);
    expect(response.series[0]?.points).toEqual([
      { bucketStart: "2026-04-02T00:00:00.000Z", value: 0.4 },
      { bucketStart: "2026-04-02T00:01:00.000Z", value: null },
      { bucketStart: "2026-04-02T00:02:00.000Z", value: null },
    ]);
  });

  it("returns an empty series list when the DAO yields no rows (no data either side)", async () => {
    const service = new DefaultMetricDeriveService({
      metricDao: createMetricDao({ queryDerivedSeries: vi.fn().mockResolvedValue([]) }),
    });

    const response = await service.derive({
      numerator: { metricName: "agent.tool.call", aggregator: "count" },
      denominator: { metricName: "agent.tool.call", aggregator: "count" },
      op: "ratio",
      bucket: "1m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:10:00.000Z",
    });

    expect(response.series).toEqual([]);
  });

  it("passes the inline derive spec straight to the DAO with parsed dates and null tag filters", async () => {
    const queryDerivedSeries = vi.fn().mockResolvedValue([]);
    const service = new DefaultMetricDeriveService({
      metricDao: createMetricDao({ queryDerivedSeries }),
    });

    await service.derive({
      numerator: {
        metricName: "agent.tool.call",
        aggregator: "count",
        tagFilters: { tool: { op: "eq", value: "Wait" } },
      },
      denominator: { metricName: "agent.tool.call", aggregator: "count" },
      op: "ratio",
      bucket: "1m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:01:00.000Z",
    });

    expect(queryDerivedSeries).toHaveBeenCalledWith({
      numerator: {
        metricName: "agent.tool.call",
        aggregator: "count",
        tagFilters: { tool: { op: "eq", value: "Wait" } },
      },
      denominator: { metricName: "agent.tool.call", aggregator: "count", tagFilters: null },
      op: "ratio",
      startAt: new Date("2026-04-02T00:00:00.000Z"),
      endAt: new Date("2026-04-02T00:01:00.000Z"),
      bucket: "1m",
    });
  });
});
