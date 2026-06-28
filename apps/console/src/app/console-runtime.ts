import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { loadStaticConfig } from "@kagami/server-core/config/config.loader";
import { configureSqlite, createDbClient, type Database } from "@kagami/server-core/db/client";
import { PrismaLogDao } from "@kagami/server-core/logger/dao/impl/log.impl.dao";
import { PrismaLlmChatCallDao } from "@kagami/server-core/dao/impl/llm-chat-call.impl.dao";
import { PrismaNapcatEventDao } from "@kagami/server-core/dao/impl/napcat-event.impl.dao";
import { PrismaNapcatQqMessageDao } from "@kagami/server-core/dao/impl/napcat-group-message.impl.dao";
import { BizError } from "@kagami/server-core/common/errors/biz-error";
import { toHttpErrorResponse } from "@kagami/server-core/common/errors/http-error";
import { AppLogger } from "@kagami/server-core/logger/logger";
import { withTraceContext } from "@kagami/server-core/logger/runtime";
import { HealthHandler } from "./http/health.handler.js";
import { AppLogHandler } from "../ops/http/app-log.handler.js";
import { LlmChatCallHandler } from "../ops/http/llm-chat-call.handler.js";
import { NapcatEventHandler } from "../ops/http/napcat-event.handler.js";
import { NapcatQqMessageHandler } from "../ops/http/napcat-group-message.handler.js";
import { DefaultAppLogQueryService } from "../ops/application/app-log-query.impl.service.js";
import { DefaultLlmChatCallQueryService } from "../ops/application/llm-chat-call-query.impl.service.js";
import { DefaultNapcatEventQueryService } from "../ops/application/napcat-event-query.impl.service.js";
import { DefaultNapcatQqMessageQueryService } from "../ops/application/napcat-group-message-query.impl.service.js";

const TRACE_ID_HEADER_NAME = "X-Kagami-Trace-Id";
const logger = new AppLogger({ source: "console-bootstrap" });

type AppRouteHandler = {
  register(app: FastifyInstance): void;
};

export type ConsoleRuntime = {
  app: FastifyInstance;
  database: Database;
};

/**
 * 管理台后端（console）运行时装配。console 是独立进程，只服务前端的纯 DB 查询接口，
 * 不持有任何 Agent 活内存（事件队列 / HNSW / NapCat 网关都在 server 进程）。它与 server
 * 经 `@kagami/server-core` 共享 Prisma DAO，各自 new 一份 DAO 连同一个 SQLite 库文件。
 */
export async function buildConsoleRuntime(): Promise<ConsoleRuntime> {
  const config = await loadStaticConfig();

  const database = createDbClient({
    databaseUrl: config.server.databaseUrl,
  });
  // 与 server 进程并发读写同一 SQLite 文件：开 WAL（库文件级持久设置，设一次长期生效）。
  await configureSqlite(database);

  const logDao = new PrismaLogDao({ database });
  const llmChatCallDao = new PrismaLlmChatCallDao({ database });
  const napcatEventDao = new PrismaNapcatEventDao({ database });
  const napcatQqMessageDao = new PrismaNapcatQqMessageDao({ database });

  const appLogQueryService = new DefaultAppLogQueryService({ logDao });
  const llmChatCallQueryService = new DefaultLlmChatCallQueryService({
    llmChatCallDao,
  });
  const napcatEventQueryService = new DefaultNapcatEventQueryService({
    napcatEventDao,
  });
  const napcatQqMessageQueryService = new DefaultNapcatQqMessageQueryService({
    napcatQqMessageDao,
  });

  const app = createConsoleApp({
    handlers: [
      new HealthHandler(),
      new AppLogHandler({ appLogQueryService }),
      new LlmChatCallHandler({ llmChatCallQueryService }),
      new NapcatEventHandler({ napcatEventQueryService }),
      new NapcatQqMessageHandler({ napcatQqMessageQueryService }),
    ],
  });

  return { app, database };
}

function createConsoleApp({ handlers }: { handlers: AppRouteHandler[] }): FastifyInstance {
  const app = Fastify({ logger: false, disableRequestLogging: true });

  app.addHook("onRequest", (_request, reply, done) => {
    const traceId = randomUUID();
    reply.header(TRACE_ID_HEADER_NAME, traceId);

    withTraceContext(traceId, () => {
      done();
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      logger.warn("Request validation failed", {
        event: "http.request.validation_failed",
        method: request.method,
        url: request.url,
        issues: error.issues,
      });

      return reply.code(400).send({
        message: "请求参数不合法",
      });
    }

    if (error instanceof BizError) {
      logger.errorWithCause("Handled business request error", error, {
        event: "http.request.biz_error",
        method: request.method,
        url: request.url,
        ...(error.meta ?? {}),
      });

      const response = toHttpErrorResponse(error);
      return reply.code(response.statusCode).send(response.body);
    }

    logger.errorWithCause("Unhandled request error", error, {
      event: "http.request.unhandled_error",
      method: request.method,
      url: request.url,
    });

    return reply.code(500).send({
      message: "服务器内部错误",
    });
  });

  for (const handler of handlers) {
    handler.register(app);
  }

  return app;
}
