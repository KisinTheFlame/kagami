import { describe, expect, it, vi } from "vitest";
import { DefaultLlmObservabilityService } from "../../src/metric/application/llm-observability.impl.service.js";
import type {
  LlmObservabilityDao,
  LlmModelCount,
  LlmOverviewStats,
  LlmTimeseriesRow,
} from "@kagami/persistence/dao/llm-observability.dao";

function createDao(overrides: Partial<LlmObservabilityDao>): LlmObservabilityDao {
  return {
    overviewStats: vi.fn(),
    modelBreakdown: vi.fn(),
    timeseries: vi.fn(),
    ...overrides,
  };
}

function createStats(overrides: Partial<LlmOverviewStats> = {}): LlmOverviewStats {
  return {
    totalCalls: 0,
    errorCount: 0,
    latencyAvgMs: null,
    latencyP95Ms: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    ...overrides,
  };
}

describe("DefaultLlmObservabilityService.overview", () => {
  it("computes error rate and maps token totals", async () => {
    const service = new DefaultLlmObservabilityService({
      llmObservabilityDao: createDao({
        overviewStats: vi.fn().mockResolvedValue(
          createStats({
            totalCalls: 200,
            errorCount: 10,
            latencyAvgMs: 123.4,
            latencyP95Ms: 900,
            promptTokens: 1000,
            completionTokens: 500,
            totalTokens: 1500,
            cacheHitTokens: 800,
            cacheMissTokens: 200,
          }),
        ),
        modelBreakdown: vi
          .fn()
          .mockResolvedValue([
            { provider: "openai", model: "gpt-5.5", count: 120 },
          ] satisfies LlmModelCount[]),
      }),
    });

    const result = await service.overview({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-01T01:00:00.000Z",
    });

    expect(result.totalCalls).toBe(200);
    expect(result.errorCount).toBe(10);
    expect(result.errorRate).toBeCloseTo(0.05);
    expect(result.latencyP95Ms).toBe(900);
    expect(result.tokens).toEqual({
      prompt: 1000,
      completion: 500,
      total: 1500,
      cacheHit: 800,
      cacheMiss: 200,
    });
    expect(result.byModel).toEqual([{ provider: "openai", model: "gpt-5.5", count: 120 }]);
  });

  it("returns error rate 0 when there are no calls (no divide-by-zero)", async () => {
    const service = new DefaultLlmObservabilityService({
      llmObservabilityDao: createDao({
        overviewStats: vi.fn().mockResolvedValue(createStats({ totalCalls: 0, errorCount: 0 })),
        modelBreakdown: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await service.overview({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-01T01:00:00.000Z",
    });

    expect(result.errorRate).toBe(0);
    expect(result.byModel).toEqual([]);
  });
});

describe("DefaultLlmObservabilityService.timeseries", () => {
  it("fills every bucket in range; missing count buckets become 0 (single series)", async () => {
    const rows: LlmTimeseriesRow[] = [
      { bucketStart: new Date("2026-01-01T00:01:00.000Z"), seriesKey: null, value: 5 },
    ];
    const service = new DefaultLlmObservabilityService({
      llmObservabilityDao: createDao({ timeseries: vi.fn().mockResolvedValue(rows) }),
    });

    const result = await service.timeseries({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-01T00:02:00.000Z",
      bucket: "1m",
      metric: "calls",
    });

    expect(result.series).toHaveLength(1);
    const series = result.series[0]!;
    expect(series.key).toBe("__all__");
    expect(series.label).toBe("全部");
    expect(series.points).toEqual([
      { bucketStart: "2026-01-01T00:00:00.000Z", value: 0 },
      { bucketStart: "2026-01-01T00:01:00.000Z", value: 5 },
      { bucketStart: "2026-01-01T00:02:00.000Z", value: 0 },
    ]);
  });

  it("keeps missing latency buckets as null instead of 0", async () => {
    const service = new DefaultLlmObservabilityService({
      llmObservabilityDao: createDao({ timeseries: vi.fn().mockResolvedValue([]) }),
    });

    const result = await service.timeseries({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-01T00:01:00.000Z",
      bucket: "1m",
      metric: "latencyP95",
    });

    expect(result.series[0]!.points.every(point => point.value === null)).toBe(true);
  });

  it("splits grouped rows into one series per key", async () => {
    const rows: LlmTimeseriesRow[] = [
      { bucketStart: new Date("2026-01-01T00:00:00.000Z"), seriesKey: "gpt-5.5", value: 3 },
      { bucketStart: new Date("2026-01-01T00:00:00.000Z"), seriesKey: "deepseek-chat", value: 7 },
    ];
    const service = new DefaultLlmObservabilityService({
      llmObservabilityDao: createDao({ timeseries: vi.fn().mockResolvedValue(rows) }),
    });

    const result = await service.timeseries({
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-01T00:00:00.000Z",
      bucket: "1m",
      metric: "calls",
      groupBy: "model",
    });

    expect(result.series.map(series => series.key).sort()).toEqual(["deepseek-chat", "gpt-5.5"]);
  });
});
