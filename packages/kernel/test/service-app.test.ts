import { describe, expect, it } from "vitest";
import { z } from "zod";
import { initLoggerRuntime } from "../src/logger/runtime.js";
import { AppLogger } from "../src/logger/logger.js";
import { BizError } from "../src/errors/biz-error.js";
import { createServiceApp } from "../src/http/service-app.js";

// 默认错误处理器是未传 errorHandler 的卫星服务（console/metric）的兜底错误契约：
// 三分支的状态码与 body 形状在这里钉死（issue #274）。
initLoggerRuntime({ sinks: [] });
const logger = new AppLogger({ source: "service-app-test" });

function buildApp() {
  return createServiceApp({
    logger,
    handlers: [
      {
        register: app => {
          app.get("/ok", () => ({ fine: true }));
          app.get("/zod", () => {
            throw new z.ZodError([]);
          });
          app.get("/biz", () => {
            throw new BizError({ message: "业务错误", statusCode: 404 });
          });
          app.get("/boom", () => {
            throw new Error("boom");
          });
        },
      },
    ],
  });
}

describe("createServiceApp 默认错误出口", () => {
  it("ZodError → 400 + 请求参数不合法", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/zod" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: "请求参数不合法" });
    await app.close();
  });

  it("BizError → 自带 statusCode + message（toHttpErrorResponse 面向前端形状）", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/biz" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ message: "业务错误" });
    await app.close();
  });

  it("未知错误 → 500 + 服务器内部错误（不泄漏原始 message）", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ message: "服务器内部错误" });
    await app.close();
  });

  it("每个响应带 X-Kagami-Trace-Id 头", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/ok" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-kagami-trace-id"]).toMatch(/[0-9a-f-]{36}/);
    await app.close();
  });
});
