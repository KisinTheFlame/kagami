import { describe, expect, it, vi } from "vitest";
import type { MetricDao } from "../../src/metric/infra/metric.dao.js";
import { DefaultMetricService } from "../../src/metric/application/metric.impl.service.js";
import { initTestLogger } from "../helpers/logger.js";

describe("DefaultMetricService", () => {
  it("should normalize inputs before persisting metrics", async () => {
    const metricDao = createMetricDao();
    const service = new DefaultMetricService({ metricDao });
    const occurredAt = new Date("2026-04-01T15:00:00.000Z");

    await service.record({
      metricName: "  llm.token.total  ",
      value: 123,
      tags: {
        " provider ": "openai",
        model: "gpt-4o-mini",
      },
      occurredAt,
    });

    expect(metricDao.insert).toHaveBeenCalledWith({
      metricName: "llm.token.total",
      value: 123,
      tags: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
      occurredAt,
    });
  });

  it("should default tags to an empty object", async () => {
    const metricDao = createMetricDao();
    const service = new DefaultMetricService({ metricDao });

    await service.record({
      metricName: "http.request.count",
      value: 1,
    });

    expect(metricDao.insert).toHaveBeenCalledWith({
      metricName: "http.request.count",
      value: 1,
      tags: {},
      occurredAt: undefined,
    });
  });

  it("should reject invalid metric input", async () => {
    const metricDao = createMetricDao();
    const service = new DefaultMetricService({ metricDao });

    await expect(
      service.record({
        metricName: "   ",
        value: Number.NaN,
      }),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "Metric 打点参数不合法",
      meta: {
        reason: "METRIC_RECORD_INVALID",
      },
      statusCode: 400,
    });
    expect(metricDao.insert).not.toHaveBeenCalled();
  });

  it("should reject blank metric tag keys", async () => {
    const metricDao = createMetricDao();
    const service = new DefaultMetricService({ metricDao });

    await expect(
      service.record({
        metricName: "queue.depth",
        value: 5,
        tags: {
          "   ": "bad",
        },
      }),
    ).rejects.toMatchObject({
      name: "BizError",
      message: "Metric 打点参数不合法",
      meta: {
        reason: "METRIC_RECORD_INVALID",
      },
      statusCode: 400,
    });
    expect(metricDao.insert).not.toHaveBeenCalled();
  });

  it("should log and swallow metric persistence errors", async () => {
    const logs = initTestLogger();
    const metricDao = createMetricDao({
      insert: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const service = new DefaultMetricService({ metricDao });

    await expect(
      service.record({
        metricName: "queue.depth",
        value: 8,
        tags: {
          queue: "main",
        },
      }),
    ).resolves.toBeUndefined();

    expect(metricDao.insert).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      message: "Failed to persist metric record",
      metadata: expect.objectContaining({
        source: "metric.service",
        event: "metric.record.persist_failed",
        metricName: "queue.depth",
        value: 8,
        tags: {
          queue: "main",
        },
        error: expect.objectContaining({
          message: "db down",
        }),
      }),
    });
  });
});

function createMetricDao(overrides?: Partial<MetricDao>): MetricDao {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    queryChartSeries: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}
