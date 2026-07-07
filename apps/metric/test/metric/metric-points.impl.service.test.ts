import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DuckDbMetricDao,
  openMetricDuckDb,
} from "../../src/metric/infra/impl/duckdb-metric.impl.dao.js";
import { DefaultMetricPointsService } from "../../src/metric/application/metric-points.impl.service.js";

// 端到端（内存 DuckDB + service）验证 raw 原始点查询：不聚合、不分桶、每个原始点照出，
// groupByTag 分组、tagFilter、升序、truncated 边界。

const METRIC = "llm.oauth.quota.remaining_percent";
const iso = (s: string) => new Date(s);

describe("DefaultMetricPointsService", () => {
  let dao: DuckDbMetricDao;
  let service: DefaultMetricPointsService;

  beforeEach(async () => {
    dao = await openMetricDuckDb(":memory:");
    service = new DefaultMetricPointsService({ metricDao: dao });
  });

  afterEach(() => {
    dao.close();
  });

  it("returns every raw point in ascending time order, no aggregation", async () => {
    for (const [minute, value] of [
      ["00", 98],
      ["10", 96],
      ["20", 95],
    ] as const) {
      await dao.insert({
        metricName: METRIC,
        value,
        tags: { window: "five_hour" },
        occurredAt: iso(`2026-07-06T10:${minute}:00.000Z`),
      });
    }

    const response = await service.query({
      metricName: METRIC,
      startAt: "2026-07-06T09:00:00.000Z",
      endAt: "2026-07-06T11:00:00.000Z",
    });

    expect(response.truncated).toBe(false);
    expect(response.series).toHaveLength(1);
    expect(response.series[0]?.points).toEqual([
      { occurredAt: "2026-07-06T10:00:00.000Z", value: 98 },
      { occurredAt: "2026-07-06T10:10:00.000Z", value: 96 },
      { occurredAt: "2026-07-06T10:20:00.000Z", value: 95 },
    ]);
  });

  it("splits into series by groupByTag", async () => {
    await dao.insert({
      metricName: METRIC,
      value: 98,
      tags: { window: "five_hour" },
      occurredAt: iso("2026-07-06T10:00:00.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 28,
      tags: { window: "seven_day" },
      occurredAt: iso("2026-07-06T10:00:00.000Z"),
    });

    const response = await service.query({
      metricName: METRIC,
      groupByTag: "window",
      startAt: "2026-07-06T09:00:00.000Z",
      endAt: "2026-07-06T11:00:00.000Z",
    });

    const byKey = Object.fromEntries(response.series.map(s => [s.key, s.points.map(p => p.value)]));
    expect(byKey).toEqual({ five_hour: [98], seven_day: [28] });
  });

  it("applies tag filters (eq)", async () => {
    await dao.insert({
      metricName: METRIC,
      value: 98,
      tags: { provider: "claude-code", window: "five_hour" },
      occurredAt: iso("2026-07-06T10:00:00.000Z"),
    });
    await dao.insert({
      metricName: METRIC,
      value: 50,
      tags: { provider: "openai-codex", window: "five_hour" },
      occurredAt: iso("2026-07-06T10:00:00.000Z"),
    });

    const response = await service.query({
      metricName: METRIC,
      tagFilters: { provider: { op: "eq", value: "claude-code" } },
      groupByTag: "window",
      startAt: "2026-07-06T09:00:00.000Z",
      endAt: "2026-07-06T11:00:00.000Z",
    });

    expect(response.series).toHaveLength(1);
    expect(response.series[0]?.points.map(p => p.value)).toEqual([98]);
  });

  it("does not aggregate points that land in the same coarse interval", async () => {
    // 三个 10 分钟点若按 30m 桶聚合会塌成 1 个；raw 必须仍是 3 个。
    for (const minute of ["00", "10", "20"] as const) {
      await dao.insert({
        metricName: METRIC,
        value: 90,
        tags: {},
        occurredAt: iso(`2026-07-06T10:${minute}:00.000Z`),
      });
    }

    const response = await service.query({
      metricName: METRIC,
      startAt: "2026-07-06T09:00:00.000Z",
      endAt: "2026-07-06T11:00:00.000Z",
    });

    expect(response.series[0]?.points).toHaveLength(3);
  });
});
