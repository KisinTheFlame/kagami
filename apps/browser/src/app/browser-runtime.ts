import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppLogger } from "@kagami/kernel/logger/logger";
import {
  createServiceApp,
  type AppRouteHandler,
  type ServiceErrorHandler,
} from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { BrowserService } from "../application/browser.service.js";
import { SerialExecutor } from "../application/serial-executor.js";
import { BrowserError } from "../domain/errors.js";
import { BrowserHandler } from "../http/browser.handler.js";
import { loadBrowserProcessConfig } from "./config.js";

const logger = new AppLogger({ source: "browser-bootstrap" });

export type BrowserRuntime = {
  app: FastifyInstance;
  service: BrowserService;
  port: number;
};

/**
 * 浏览器进程（kagami-browser）运行时装配。独立 PM2 进程，自管 CloakBrowser 生命周期，
 * agent 重启不影响它（issue #173）。零持久化：不碰共享 SQLite（epic #539 子 issue 1），
 * 登录态全在 CloakBrowser 的 userDataDir profile 里。
 */
export async function buildBrowserRuntime(): Promise<BrowserRuntime> {
  const config = await loadBrowserProcessConfig();

  const service = new BrowserService({
    config: {
      headless: config.browser.headless,
      userDataDir: config.browser.userDataDir,
      proxy: config.browser.proxy,
      licenseKey: config.browser.licenseKey,
    },
  });
  const serial = new SerialExecutor();

  const app = createBrowserApp({
    handlers: [new HealthHandler(), new BrowserHandler({ service, serial })],
  });

  return { app, service, port: config.port };
}

function createBrowserApp({ handlers }: { handlers: AppRouteHandler[] }): FastifyInstance {
  // 统一错误出口：BrowserError → 422 + { code, message, context }，让 agent 侧 client
  // 原样重建 BrowserError（KV 字节契约）。ZodError / 未知错误也归一成同形状的 wire，
  // 保证 client 永远拿到 { code, message, context }。
  const errorHandler: ServiceErrorHandler = (error, request, reply) => {
    if (error instanceof z.ZodError) {
      logger.warn("Browser request validation failed", {
        event: "browser.http.validation_failed",
        method: request.method,
        url: request.url,
        issues: error.issues,
      });
      return reply
        .code(400)
        .send({ code: "BROWSER_ERROR", message: "请求参数不合法", context: {} });
    }

    if (error instanceof BrowserError) {
      return reply
        .code(422)
        .send({ code: error.code, message: error.message, context: error.contextInfo });
    }

    logger.errorWithCause("Unhandled browser request error", error, {
      event: "browser.http.unhandled_error",
      method: request.method,
      url: request.url,
    });
    return reply
      .code(500)
      .send({ code: "BROWSER_ERROR", message: "浏览器服务内部错误", context: {} });
  };

  return createServiceApp({ logger, handlers, errorHandler });
}
