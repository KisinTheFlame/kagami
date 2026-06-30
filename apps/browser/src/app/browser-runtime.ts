import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { configureSqlite, createDbClient, type Database } from "@kagami/server-core/db/client";
import { AppLogger } from "@kagami/server-core/logger/logger";
import { withTraceContext } from "@kagami/server-core/logger/runtime";
import { BrowserService } from "../application/browser.service.js";
import { SerialExecutor } from "../application/serial-executor.js";
import { BrowserError } from "../domain/errors.js";
import { PrismaBrowserCredentialDao } from "../infra/prisma-browser-credential.dao.js";
import { BrowserHandler } from "../http/browser.handler.js";
import { HealthHandler } from "../http/health.handler.js";
import { loadBrowserProcessConfig } from "./config.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "browser-bootstrap" });

type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type BrowserRuntime = {
  app: FastifyInstance;
  database: Database;
  service: BrowserService;
  port: number;
};

/**
 * 浏览器进程（kagami-browser）运行时装配。独立 PM2 进程，自管 CloakBrowser 生命周期，
 * agent 重启不影响它（issue #173）。经 @kagami/server-core 直读同一 SQLite 的
 * browser_credential 表注入凭据——明文只在本进程内停留，永不过 HTTP、永不回 agent。
 */
export async function buildBrowserRuntime(): Promise<BrowserRuntime> {
  const config = await loadBrowserProcessConfig();

  const database = createDbClient({ databaseUrl: config.databaseUrl });
  // 与 agent / console 并发读同一 SQLite 文件：开 WAL（库文件级持久设置）。
  await configureSqlite(database);

  const credentialDao = new PrismaBrowserCredentialDao({ database });
  const service = new BrowserService({
    config: {
      headless: config.browser.headless,
      userDataDir: config.browser.userDataDir,
      proxy: config.browser.proxy,
      licenseKey: config.browser.licenseKey,
    },
    credentialDao,
  });
  const serial = new SerialExecutor();

  const app = createBrowserApp({
    handlers: [new HealthHandler(), new BrowserHandler({ service, serial })],
  });

  return { app, database, service, port: config.port };
}

function createBrowserApp({ handlers }: { handlers: AppRouteHandler[] }): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });

  app.addHook("onRequest", (_request, reply, done) => {
    const traceId = randomUUID();
    reply.header(TRACE_ID_HEADER_NAME, traceId);
    withTraceContext(traceId, () => {
      done();
    });
  });

  // 统一错误出口：BrowserError → 422 + { code, message, context }，让 agent 侧 client
  // 原样重建 BrowserError（KV 字节契约）。ZodError / 未知错误也归一成同形状的 wire，
  // 保证 client 永远拿到 { code, message, context }。
  app.setErrorHandler((error, request, reply) => {
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
  });

  for (const handler of handlers) {
    handler.register(app);
  }

  return app;
}
