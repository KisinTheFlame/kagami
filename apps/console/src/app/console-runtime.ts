import type { FastifyInstance } from "fastify";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { configureSqlite, createDbClient, type Database } from "@kagami/persistence/db/client";
import { PrismaLogDao } from "@kagami/persistence/logger/dao/impl/log.impl.dao";
import { PrismaLlmChatCallDao } from "@kagami/persistence/dao/impl/llm-chat-call.impl.dao";
import { PrismaInnerThoughtDao } from "@kagami/persistence/dao/impl/inner-thought.impl.dao";
import { PrismaNapcatEventDao } from "@kagami/persistence/dao/impl/napcat-event.impl.dao";
import { PrismaNapcatQqMessageDao } from "@kagami/persistence/dao/impl/napcat-group-message.impl.dao";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { AppLogHandler } from "../ops/http/app-log.handler.js";
import { LlmChatCallHandler } from "../ops/http/llm-chat-call.handler.js";
import { InnerThoughtHandler } from "../ops/http/inner-thought.handler.js";
import { NapcatEventHandler } from "../ops/http/napcat-event.handler.js";
import { NapcatQqMessageHandler } from "../ops/http/napcat-group-message.handler.js";
import { DefaultAppLogQueryService } from "../ops/application/app-log-query.impl.service.js";
import { DefaultLlmChatCallQueryService } from "../ops/application/llm-chat-call-query.impl.service.js";
import { DefaultInnerThoughtQueryService } from "../ops/application/inner-thought-query.impl.service.js";
import { DefaultNapcatEventQueryService } from "../ops/application/napcat-event-query.impl.service.js";
import { DefaultNapcatQqMessageQueryService } from "../ops/application/napcat-group-message-query.impl.service.js";

const logger = new AppLogger({ source: "console-bootstrap" });

export type ConsoleRuntime = {
  app: FastifyInstance;
  database: Database;
  port: number;
};

/**
 * 管理台后端（console）运行时装配。console 是独立进程，只服务前端的纯 DB 查询接口，
 * 不持有任何 Agent 活内存（事件队列 / HNSW / NapCat 网关都在 server 进程）。它与 server
 * 经 `@kagami/persistence` 共享 Prisma DAO，各自 new 一份 DAO 连同一个 SQLite 库文件。
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
  const innerThoughtDao = new PrismaInnerThoughtDao({ database });
  const napcatEventDao = new PrismaNapcatEventDao({ database });
  const napcatQqMessageDao = new PrismaNapcatQqMessageDao({ database });

  const appLogQueryService = new DefaultAppLogQueryService({ logDao });
  const llmChatCallQueryService = new DefaultLlmChatCallQueryService({
    llmChatCallDao,
  });
  const innerThoughtQueryService = new DefaultInnerThoughtQueryService({
    innerThoughtDao,
  });
  const napcatEventQueryService = new DefaultNapcatEventQueryService({
    napcatEventDao,
  });
  const napcatQqMessageQueryService = new DefaultNapcatQqMessageQueryService({
    napcatQqMessageDao,
  });

  // 面向前端查询服务：traceId / 默认错误三分支（ZodError→400、BizError→toHttpErrorResponse、
  // 其余→500）都由公共装配壳提供。
  const app = createServiceApp({
    logger,
    handlers: [
      new HealthHandler(),
      new AppLogHandler({ appLogQueryService }),
      new LlmChatCallHandler({ llmChatCallQueryService }),
      new InnerThoughtHandler({ innerThoughtQueryService }),
      new NapcatEventHandler({ napcatEventQueryService }),
      new NapcatQqMessageHandler({ napcatQqMessageQueryService }),
    ],
  });

  return { app, database, port: config.services.console.port };
}
