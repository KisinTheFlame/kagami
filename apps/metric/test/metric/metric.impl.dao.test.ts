import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DuckDbMetricDao,
  openMetricDuckDb,
} from "../../src/metric/infra/impl/duckdb-metric.impl.dao.js";
import type { QueryMetricChartSeriesInput } from "../../src/metric/infra/metric.dao.js";

// 用真·内存 DuckDB 端到端验证 DAO：插入 → queryChartSeries → 逐点断言输出，
// 即「从 SQLite/Prisma 迁到 DuckDB」的行为等价保证（#475 P1）。

const METRIC = "llm.latency";
const iso = (s: string) => new Date(s);

function baseQuery(over: Partial<QueryMetricChartSeriesInput>): QueryMetricChartSeriesInput {
  return {
    metricName: METRIC,
    aggregator: "count",
    tagFilters: null,
    groupByTag: null,
    startAt: iso("2026-07-06T10:00:00.000Z"),
    endAt: iso("2026-07-06T10:05:00.000Z"),
    bucket: "1m",
    ...over,
  };
}

describe("DuckDbMetricDao", () => {
  let dao: DuckDbMetricDao;

  beforeEach(async () => {
    dao = await openMetricDuckDb(":memory:");
  });

  afterEach(() => {
    dao.close();
  });

  it("counts into the right time buckets (single series, only non-empty buckets)", async () => {
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:10.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:20.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:01:05.000Z"),
    });

    const rows = await dao.queryChartSeries(baseQuery({ aggregator: "count" }));

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: null, value: 2 },
      { bucketStart: iso("2026-07-06T10:01:00.000Z"), seriesKey: null, value: 1 },
    ]);
  });

  it("groups by a tag into multiple series", async () => {
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: { tool: "Read" },
      occurredAt: iso("2026-07-06T10:00:10.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: { tool: "Read" },
      occurredAt: iso("2026-07-06T10:00:20.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: { tool: "Wait" },
      occurredAt: iso("2026-07-06T10:00:30.000Z"),
    });

    const rows = await dao.queryChartSeries(baseQuery({ aggregator: "count", groupByTag: "tool" }));

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: "Read", value: 2 },
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: "Wait", value: 1 },
    ]);
  });

  it("applies tag equality filters", async () => {
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: { tool: "Read" },
      occurredAt: iso("2026-07-06T10:00:10.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: { tool: "Wait" },
      occurredAt: iso("2026-07-06T10:00:20.000Z"),
    });

    const rows = await dao.queryChartSeries(
      baseQuery({ aggregator: "count", tagFilters: { tool: "Wait" } }),
    );

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: null, value: 1 },
    ]);
  });

  it("computes sum / avg / max / min over value", async () => {
    for (const v of [2, 4, 6]) {
      await dao.insert({
        metricName: METRIC,
        value: v,
        tags: {},
        occurredAt: iso("2026-07-06T10:00:10.000Z"),
      });
    }
    const at = iso("2026-07-06T10:00:00.000Z");
    expect(await dao.queryChartSeries(baseQuery({ aggregator: "sum" }))).toEqual([
      { bucketStart: at, seriesKey: null, value: 12 },
    ]);
    expect(await dao.queryChartSeries(baseQuery({ aggregator: "avg" }))).toEqual([
      { bucketStart: at, seriesKey: null, value: 4 },
    ]);
    expect(await dao.queryChartSeries(baseQuery({ aggregator: "max" }))).toEqual([
      { bucketStart: at, seriesKey: null, value: 6 },
    ]);
    expect(await dao.queryChartSeries(baseQuery({ aggregator: "min" }))).toEqual([
      { bucketStart: at, seriesKey: null, value: 2 },
    ]);
  });

  it("computes percentile-free 'last' by occurred_at then insertion id tiebreak", async () => {
    // 桶内不同时刻：取较晚。
    await dao.insert({
      metricName: METRIC,
      value: 10,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:10.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 20,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:40.000Z"),
    });
    // 桶内同刻：后插入的 id 更大 → 取它。
    await dao.insert({
      metricName: METRIC,
      value: 30,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:40.000Z"),
    });

    const rows = await dao.queryChartSeries(baseQuery({ aggregator: "last" }));

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: null, value: 30 },
    ]);
  });

  it("excludes rows outside the time range", async () => {
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T09:59:59.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:10.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:06:00.000Z"),
    });

    const rows = await dao.queryChartSeries(baseQuery({ aggregator: "count" }));

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: null, value: 1 },
    ]);
  });

  it("isolates by metric name", async () => {
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:10.000Z"),
    });
    await dao.insert({
      metricName: "other.metric",
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:10.000Z"),
    });

    const rows = await dao.queryChartSeries(baseQuery({ aggregator: "count" }));

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: null, value: 1 },
    ]);
  });
});
