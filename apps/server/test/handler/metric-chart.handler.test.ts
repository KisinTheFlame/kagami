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

  it("should list chart definitions", async () => {
    const metricChartService = createMetricChartService({
      list: vi.fn().mockResolvedValue({
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
      }),
    });

    new MetricChartHandler({ metricChartService }).register(app);

    const response = await app.inject({
      method: "GET",
      url: "/metric-chart/list",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
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

  it("should create and delete chart definitions via injected service", async () => {
    const create = vi.fn().mockResolvedValue({
      chart: {
        chartName: "总请求量",
        metricName: "http.request",
        aggregator: "count",
        tagFilters: null,
        groupByTag: null,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:05:00.000Z",
      },
    });
    const remove = vi.fn().mockResolvedValue({
      chartName: "总请求量",
      deleted: true,
    });
    const metricChartService = createMetricChartService({
      create,
      delete: remove,
    });

    new MetricChartHandler({ metricChartService }).register(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/metric-chart/create",
      payload: {
        chartName: "总请求量",
        metricName: "http.request",
        aggregator: "count",
      },
    });
    const deleteResponse = await app.inject({
      method: "POST",
      url: "/metric-chart/delete",
      payload: {
        chartName: "总请求量",
      },
    });

    expect(createResponse.statusCode).toBe(200);
    expect(deleteResponse.statusCode).toBe(200);
    expect(create).toHaveBeenCalledWith({
      chartName: "总请求量",
      metricName: "http.request",
      aggregator: "count",
    });
    expect(remove).toHaveBeenCalledWith({
      chartName: "总请求量",
    });
  });

  it("should query chart data", async () => {
    const queryData = vi.fn().mockResolvedValue({
      chart: {
        chartName: "总请求量",
        metricName: "http.request",
        aggregator: "count",
        tagFilters: null,
        groupByTag: null,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:05:00.000Z",
      },
      bucket: "1m",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-02T00:02:00.000Z",
      series: [
        {
          key: "__default__",
          label: "总请求量",
          points: [
            {
              bucketStart: "2026-04-02T00:00:00.000Z",
              value: 1,
            },
          ],
        },
      ],
    });
    const metricChartService = createMetricChartService({
      queryData,
    });

    new MetricChartHandler({ metricChartService }).register(app);

    const response = await app.inject({
      method: "GET",
      url: "/metric-chart/data?chartName=%E6%80%BB%E8%AF%B7%E6%B1%82%E9%87%8F&bucket=1m&rangePreset=10m",
    });

    expect(response.statusCode).toBe(200);
    expect(queryData).toHaveBeenCalledWith({
      chartName: "总请求量",
      bucket: "1m",
      rangePreset: "10m",
    });
  });
});

function createMetricChartService(overrides?: Partial<MetricChartService>): MetricChartService {
  return {
    list: vi.fn().mockResolvedValue({ items: [] }),
    create: vi.fn(),
    delete: vi.fn(),
    queryData: vi.fn(),
    ...overrides,
  };
}
