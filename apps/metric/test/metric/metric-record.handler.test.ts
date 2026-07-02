import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { toHttpErrorResponse } from "@kagami/kernel/errors/http-error";
import type { MetricDao } from "@kagami/persistence/dao/metric.dao";
import { DefaultMetricRecordService } from "../../src/metric/application/metric-record.impl.service.js";
import { MetricRecordHandler } from "../../src/metric/http/metric-record.handler.js";

// 摄取纵切片测试：真实 handler + DefaultMetricRecordService，仅把 DB 边界（MetricDao.insert）打桩。
// 覆盖 zod 校验 400、normalizeTags 400、以及合法体落库入参。
describe("MetricRecordHandler", () => {
  let app: FastifyInstance = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ message: "请求参数不合法" });
      }
      if (error instanceof BizError) {
        const response = toHttpErrorResponse(error);
        return reply.code(response.statusCode).send(response.body);
      }
      return reply.code(500).send({ message: "服务器内部错误" });
    });
  });

  afterEach(async () => {
    await app.close();
  });

  function register(insert = vi.fn().mockResolvedValue(undefined)): MetricDao["insert"] {
    const metricDao = {
      insert,
      queryChartSeries: vi.fn().mockResolvedValue([]),
    } as unknown as MetricDao;
    const metricRecordService = new DefaultMetricRecordService({ metricDao });
    new MetricRecordHandler({ metricRecordService }).register(app);
    return insert;
  }

  it("should persist a valid metric record", async () => {
    const insert = register();

    const response = await app.inject({
      method: "POST",
      url: "/metric/record",
      payload: {
        metricName: "  agent.tool.call  ",
        value: 1,
        tags: { tool: "invoke:search_web", runtime: "agent" },
        occurredAt: "2026-04-01T15:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({
      metricName: "agent.tool.call",
      value: 1,
      tags: { tool: "invoke:search_web", runtime: "agent" },
      occurredAt: new Date("2026-04-01T15:00:00.000Z"),
    });
  });

  it("should default tags and omit occurredAt when absent", async () => {
    const insert = register();

    const response = await app.inject({
      method: "POST",
      url: "/metric/record",
      payload: { metricName: "http.request.count", value: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(insert).toHaveBeenCalledWith({
      metricName: "http.request.count",
      value: 1,
      tags: {},
      occurredAt: undefined,
    });
  });

  it("should reject empty metricName / non-finite value with 400", async () => {
    const insert = register();

    const blankName = await app.inject({
      method: "POST",
      url: "/metric/record",
      payload: { metricName: "   ", value: 1 },
    });
    expect(blankName.statusCode).toBe(400);

    const badValue = await app.inject({
      method: "POST",
      url: "/metric/record",
      payload: { metricName: "queue.depth", value: "NaN" },
    });
    expect(badValue.statusCode).toBe(400);

    expect(insert).not.toHaveBeenCalled();
  });

  it("should reject occurredAt without timezone with 400", async () => {
    const insert = register();

    const response = await app.inject({
      method: "POST",
      url: "/metric/record",
      payload: {
        metricName: "queue.depth",
        value: 5,
        occurredAt: "2026-04-01T15:00:00",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("should reject an out-of-range offset that yields Invalid Date with 400 (not 500)", async () => {
    const insert = register();

    const response = await app.inject({
      method: "POST",
      url: "/metric/record",
      // 过 datetime({offset:true}) 但 `new Date` 得到 Invalid Date：必须落 400，不能流到 DAO。
      payload: {
        metricName: "queue.depth",
        value: 5,
        occurredAt: "2026-04-01T15:00:00+99:00",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("should reject blank tag keys with 400", async () => {
    const insert = register();

    const response = await app.inject({
      method: "POST",
      url: "/metric/record",
      payload: {
        metricName: "queue.depth",
        value: 5,
        tags: { "   ": "bad" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: "Metric 打点参数不合法" });
    expect(insert).not.toHaveBeenCalled();
  });
});
