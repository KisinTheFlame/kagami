import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { LogHandler } from "../src/http/log.handler.js";
import type { LogService } from "../src/application/log.service.js";
import { initTestLoggerRuntime } from "./helpers/logger.js";

initTestLoggerRuntime();

/**
 * 走真实的 createServiceApp 装配壳，而不是手搭一个错误处理器——ZodError → 400 这条分支正是
 * 本测试要验的行为，自己复刻一份只会在装配壳变化时给出假绿。
 */
function registerWith(service: Pick<LogService, "ingest" | "query">): FastifyInstance {
  return createServiceApp({
    logger: new AppLogger({ source: "observatory-log-handler-test" }),
    handlers: [new LogHandler({ service: service as LogService })],
  });
}

describe("LogHandler ingest", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("合法批量上报 → 200 + accepted", async () => {
    const ingest = vi.fn().mockResolvedValue({ accepted: 1 });
    app = registerWith({ ingest, query: vi.fn() });

    const response = await app.inject({
      method: "POST",
      url: "/observatory/logs",
      payload: {
        service: "console",
        items: [
          {
            traceId: "trace-1",
            level: "info",
            message: "hello",
            metadata: { source: "console-bootstrap" },
            createdAt: "2026-07-29T00:00:00.000Z",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 1 });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ service: "console", items: expect.any(Array) }),
    );
  });

  it("空 items → 400（契约要求至少一条）", async () => {
    const ingest = vi.fn();
    app = registerWith({ ingest, query: vi.fn() });

    const response = await app.inject({
      method: "POST",
      url: "/observatory/logs",
      payload: { service: "console", items: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("超过 500 条 → 400，畸形巨批不落库", async () => {
    const ingest = vi.fn();
    app = registerWith({ ingest, query: vi.fn() });

    const response = await app.inject({
      method: "POST",
      url: "/observatory/logs",
      payload: {
        service: "console",
        items: Array.from({ length: 501 }, () => ({
          traceId: "trace-1",
          level: "info",
          message: "hello",
          metadata: {},
          createdAt: "2026-07-29T00:00:00.000Z",
        })),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("空 message 是合法的：不该让整批日志被退回", async () => {
    const ingest = vi.fn().mockResolvedValue({ accepted: 1 });
    app = registerWith({ ingest, query: vi.fn() });

    const response = await app.inject({
      method: "POST",
      url: "/observatory/logs",
      payload: {
        service: "console",
        items: [
          {
            traceId: "trace-1",
            level: "info",
            message: "",
            metadata: {},
            createdAt: "2026-07-29T00:00:00.000Z",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("LogHandler query", () => {
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    app = null;
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("转发查询条件并回传 wire 形状", async () => {
    const query = vi.fn().mockResolvedValue({
      total: 1,
      items: [
        {
          id: 1,
          service: "agent",
          traceId: "trace-1",
          level: "info",
          message: "hello",
          metadata: {},
          createdAt: "2026-07-29T00:00:00.000Z",
        },
      ],
    });
    app = registerWith({ ingest: vi.fn(), query });

    const response = await app.inject({
      method: "POST",
      url: "/observatory/logs/query",
      payload: { service: "agent", page: 1, pageSize: 20 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].service).toBe("agent");
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ service: "agent", page: 1, pageSize: 20 }),
    );
  });

  it("pageSize 超上限 → 400", async () => {
    const query = vi.fn();
    app = registerWith({ ingest: vi.fn(), query });

    const response = await app.inject({
      method: "POST",
      url: "/observatory/logs/query",
      payload: { page: 1, pageSize: 1000 },
    });

    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
