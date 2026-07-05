import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricChartService } from "../../src/metric/application/metric-chart.service.js";
import { MetricChartHandler } from "../../src/metric/http/metric-chart.handler.js";

describe("MetricChartHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should query chart data from an inline spec via POST /metric/query", async () => {
    const query = vi.fn().mockResolvedValue({
      bucket: "1m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:02:00.000Z",
      series: [
        {
          key: "__default__",
          label: "http.request",
          points: [{ bucketStart: "2026-04-02T00:00:00.000Z", value: 1 }],
        },
      ],
    });
    const metricChartService = createMetricChartService({ query });

    new MetricChartHandler({ metricChartService }).register(app);

    const response = await app.inject({
      method: "POST",
      url: "/metric/query",
      payload: {
        metricName: "http.request",
        aggregator: "count",
        bucket: "1m",
        rangePreset: "10m",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith({
      metricName: "http.request",
      aggregator: "count",
      bucket: "1m",
      rangePreset: "10m",
    });
    expect(response.json()).toMatchObject({ bucket: "1m", series: expect.any(Array) });
  });
});

function createMetricChartService(overrides?: Partial<MetricChartService>): MetricChartService {
  return {
    query: vi.fn(),
    ...overrides,
  };
}
