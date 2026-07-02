import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { withTraceContext } from "@kagami/kernel/logger/runtime";
import { SaveStore } from "../persistence/save-store.js";
import { SpireService } from "../application/spire.service.js";
import { SpireHandler } from "../http/spire.handler.js";
import { HealthHandler } from "../http/health.handler.js";
import { loadSpireServiceConfig } from "./config.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "spire-service-bootstrap" });

type AppRouteHandler = { register(app: FastifyInstance): void };

export type SpireServiceRuntime = {
  app: FastifyInstance;
  port: number;
};

/**
 * kagami-spire 进程运行时装配。独立 PM2 进程，持有内存对局 + JSON 存档，纯游戏后端。
 * 无 DB、无 LLM 依赖——与 agent 完全隔离（设计文档 P1/P2）。
 */
export async function buildSpireServiceRuntime(): Promise<SpireServiceRuntime> {
  const { port, saveDir } = await loadSpireServiceConfig();

  const store = new SaveStore({ dir: saveDir });
  const service = new SpireService({ store });
  await service.init();

  const app = createSpireServiceApp({
    handlers: [new HealthHandler(), new SpireHandler({ service })],
  });

  return { app, port };
}

export function createSpireServiceApp({
  handlers,
}: {
  handlers: AppRouteHandler[];
}): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });

  app.addHook("onRequest", (_request, reply, done) => {
    const traceId = randomUUID();
    reply.header(TRACE_ID_HEADER_NAME, traceId);
    withTraceContext(traceId, () => {
      done();
    });
  });

  // 统一错误出口：请求参数不合法 → 400 { error }；其余 → 500。localhost 内部 RPC，保留原始 message 便于排查。
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      logger.warn("Spire service request validation failed", {
        event: "spire_service.http.validation_failed",
        method: request.method,
        url: request.url,
        issues: error.issues,
      });
      return reply.code(400).send({ error: { message: "请求参数不合法", statusCode: 400 } });
    }
    logger.errorWithCause("Unhandled spire service request error", error, {
      event: "spire_service.http.unhandled_error",
      method: request.method,
      url: request.url,
    });
    return reply.code(500).send({
      error: {
        message: error instanceof Error ? error.message : "尖塔服务内部错误",
        statusCode: 500,
      },
    });
  });

  for (const handler of handlers) {
    handler.register(app);
  }
  return app;
}
