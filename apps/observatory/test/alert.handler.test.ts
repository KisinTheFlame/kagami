import { describe, expect, it, vi } from "vitest";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { AlertService } from "../src/application/alert.service.js";
import { AlertThrottle } from "../src/application/alert-throttle.js";
import { AlertHandler } from "../src/http/alert.handler.js";
import { initTestLoggerRuntime } from "./helpers/logger.js";

initTestLoggerRuntime();

/**
 * 路由层的状态码语义（issue #602）：入参不合契约 → 400；其余一律 200，结局由 body 的
 * delivered / suppressed 表达。经 app.inject，不开真端口。
 */
describe("AlertHandler", () => {
  function makeApp(options: { deliver?: () => Promise<void> } = {}) {
    const deliver = vi.fn<(message: string) => Promise<void>>(options.deliver ?? (async () => {}));
    const nowMs = 1_000_000;
    const service = new AlertService({
      channel: { deliver },
      throttle: new AlertThrottle({ now: () => new Date(nowMs) }),
      now: () => new Date(nowMs),
    });
    const app = createServiceApp({
      logger: new AppLogger({ source: "observatory-test" }),
      handlers: [new HealthHandler(), new AlertHandler({ service })],
    });

    return { app, deliver };
  }

  const validPayload = {
    source: "manual",
    event: "smoke",
    severity: "warn",
    title: "通道验证",
  };

  it("合法载荷 → 200 + delivered，通道文本首行为标头", async () => {
    const { app, deliver } = makeApp();

    const response = await app.inject({
      method: "POST",
      url: "/observatory/alert",
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ delivered: true, suppressed: false });
    expect(deliver.mock.calls[0]![0].split("\n")[0]).toBe("【warn】manual · smoke");
    await app.close();
  });

  it("窗口内重复 → 200 + suppressed，通道不再被调用", async () => {
    const { app, deliver } = makeApp();

    await app.inject({ method: "POST", url: "/observatory/alert", payload: validPayload });
    const response = await app.inject({
      method: "POST",
      url: "/observatory/alert",
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ delivered: false, suppressed: true });
    expect(deliver).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("通道失败 → 仍 200，body 表达 delivered:false / suppressed:false（不是调用方的错，不该重试）", async () => {
    const { app } = makeApp({
      deliver: async () => {
        throw new Error("napcat down");
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/observatory/alert",
      payload: validPayload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ delivered: false, suppressed: false });
    await app.close();
  });

  it("severity 非三档之一 → 400，通道未被调用", async () => {
    const { app, deliver } = makeApp();

    const response = await app.inject({
      method: "POST",
      url: "/observatory/alert",
      payload: { ...validPayload, severity: "critical" },
    });

    expect(response.statusCode).toBe(400);
    expect(deliver).not.toHaveBeenCalled();
    await app.close();
  });

  it("缺必填字段 → 400", async () => {
    const { app, deliver } = makeApp();

    const response = await app.inject({
      method: "POST",
      url: "/observatory/alert",
      payload: { source: "manual", event: "smoke", severity: "warn" },
    });

    expect(response.statusCode).toBe(400);
    expect(deliver).not.toHaveBeenCalled();
    await app.close();
  });

  it("多余字段 → 400（契约 .strict()）", async () => {
    const { app } = makeApp();

    const response = await app.inject({
      method: "POST",
      url: "/observatory/alert",
      payload: { ...validPayload, unexpected: "x" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("/health → 200", async () => {
    const { app } = makeApp();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
