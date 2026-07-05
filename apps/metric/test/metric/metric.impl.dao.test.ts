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
      baseQuery({ aggregator: "count", tagFilters: { tool: { op: "eq", value: "Wait" } } }),
    );

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: null, value: 1 },
    ]);
  });

  it("applies ne tag filters as a complement (includes rows missing the tag)", async () => {
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: { tool: "Wait" },
      occurredAt: iso("2026-07-06T10:00:10.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: { tool: "Read" },
      occurredAt: iso("2026-07-06T10:00:20.000Z"),
    });
    // tag 缺失的行也算「不等于 Wait」→ 补集语义命中。
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:30.000Z"),
    });

    const rows = await dao.queryChartSeries(
      baseQuery({ aggregator: "count", tagFilters: { tool: { op: "ne", value: "Wait" } } }),
    );

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: null, value: 2 },
    ]);
  });

  it("applies in tag filters (membership, absent tag excluded)", async () => {
    for (const tool of ["Read", "Write", "Wait"]) {
      await dao.insert({
        metricName: METRIC,
        value: 1,
        tags: { tool },
        occurredAt: iso("2026-07-06T10:00:10.000Z"),
      });
    }
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:20.000Z"),
    });

    const rows = await dao.queryChartSeries(
      baseQuery({
        aggregator: "count",
        tagFilters: { tool: { op: "in", value: ["Read", "Write"] } },
      }),
    );

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:00.000Z"), seriesKey: null, value: 2 },
    ]);
  });

  it("computes percentiles (p50 / p95 / p99) from raw samples in the bucket", async () => {
    // 桶内样本 1..100；quantile_cont 连续插值：p50=50.5, p95≈95.05, p99≈99.01。
    for (let v = 1; v <= 100; v++) {
      await dao.insert({
        metricName: METRIC,
        value: v,
        tags: {},
        occurredAt: iso("2026-07-06T10:00:10.000Z"),
      });
    }
    const at = iso("2026-07-06T10:00:00.000Z");

    const [p50] = await dao.queryChartSeries(baseQuery({ aggregator: "p50" }));
    const [p95] = await dao.queryChartSeries(baseQuery({ aggregator: "p95" }));
    const [p99] = await dao.queryChartSeries(baseQuery({ aggregator: "p99" }));

    expect(p50?.bucketStart).toEqual(at);
    expect(p50?.value).toBeCloseTo(50.5, 5);
    expect(p95?.value).toBeCloseTo(95.05, 5);
    expect(p99?.value).toBeCloseTo(99.01, 5);
  });

  it("pushes series top-N down to SQL: caps a high-cardinality groupByTag to 20 by magnitude", async () => {
    // 25 个 tool 分组，各占一个桶、总量 = 序号(6..30)；DAO 应在 SQL 层只留总量最大的前 20（11..30）。
    for (let index = 1; index <= 25; index++) {
      const magnitude = index + 5;
      for (let n = 0; n < magnitude; n++) {
        await dao.insert({
          metricName: METRIC,
          value: 1,
          tags: { tool: `series-${index}` },
          occurredAt: iso("2026-07-06T10:00:10.000Z"),
        });
      }
    }

    const rows = await dao.queryChartSeries(baseQuery({ aggregator: "count", groupByTag: "tool" }));

    const keys = new Set(rows.map(row => row.seriesKey));
    expect(keys.size).toBe(20);
    expect(keys.has("series-6")).toBe(true); // 总量 11，最小的保留者
    expect(keys.has("series-5")).toBe(false); // 总量 10，被裁
    expect(keys.has("series-1")).toBe(false);
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

  it("truncates sub-second timestamps into buckets (matches SQLite unixepoch, not rounding)", async () => {
    // 10:00:59.750 在 10s 桶里必须落 10:00:50（截断），而非 DuckDB CAST 四舍五入出的 10:01:00。
    await dao.insert({
      metricName: METRIC,
      value: 1,
      tags: {},
      occurredAt: iso("2026-07-06T10:00:59.750Z"),
    });

    const rows = await dao.queryChartSeries(baseQuery({ aggregator: "count", bucket: "10s" }));

    expect(rows).toEqual([
      { bucketStart: iso("2026-07-06T10:00:50.000Z"), seriesKey: null, value: 1 },
    ]);
  });

  it("defaults a missing occurredAt to now in UTC (no session-timezone drift)", async () => {
    // 不传 occurredAt：必须落到真实的当前 UTC 时刻，而非 DuckDB current_timestamp 的会话时区墙钟。
    // 若走了腐坏的列默认，非 UTC 运行环境下该点会偏移数小时、落到查询窗口外。
    const before = Date.now();
    await dao.insert({ metricName: METRIC, value: 1, tags: {} });
    const after = Date.now();

    const bucketMs = 60 * 1000;
    const rows = await dao.queryChartSeries(
      baseQuery({
        aggregator: "count",
        bucket: "1m",
        startAt: new Date(before - 60 * 60 * 1000),
        endAt: new Date(after + 60 * 60 * 1000),
      }),
    );

    expect(rows).toHaveLength(1);
    const bucketStart = rows[0]?.bucketStart.getTime() ?? 0;
    // 桶起点应落在 [插入前对齐桶, 插入后] 之间——即点确实记在“现在”，未被时区偏移推走。
    expect(bucketStart).toBeGreaterThanOrEqual(Math.floor(before / bucketMs) * bucketMs);
    expect(bucketStart).toBeLessThanOrEqual(after);
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
