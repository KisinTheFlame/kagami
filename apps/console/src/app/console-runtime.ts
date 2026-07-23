import type { FastifyInstance } from "fastify";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { createClient } from "@kagami/rpc-client/client";
import { napcatApiContract } from "@kagami/napcat-api/contract";
import { llmApiContract } from "@kagami/llm-api/contract";
import { agentApiContract } from "@kagami/agent-api/contract";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { AppLogHandler } from "../ops/http/app-log.handler.js";
import { LlmChatCallHandler } from "../ops/http/llm-chat-call.handler.js";
import { InnerThoughtHandler } from "../ops/http/inner-thought.handler.js";
import { NapcatEventHandler } from "../ops/http/napcat-event.handler.js";
import { NapcatQqMessageHandler } from "../ops/http/napcat-group-message.handler.js";
import { TodoHandler } from "../ops/http/todo.handler.js";
import { DefaultAppLogQueryService } from "../ops/application/app-log-query.impl.service.js";
import { DefaultLlmChatCallQueryService } from "../ops/application/llm-chat-call-query.impl.service.js";
import { DefaultInnerThoughtQueryService } from "../ops/application/inner-thought-query.impl.service.js";
import { DefaultNapcatEventQueryService } from "../ops/application/napcat-event-query.impl.service.js";
import { DefaultNapcatQqMessageQueryService } from "../ops/application/napcat-group-message-query.impl.service.js";
import { DefaultTodoQueryService } from "../ops/application/todo-query.impl.service.js";

const logger = new AppLogger({ source: "console-bootstrap" });

export type ConsoleRuntime = {
  app: FastifyInstance;
  port: number;
};

/**
 * 管理台后端（console）运行时装配。console 是独立进程，为前端聚合各服务的只读查询，
 * 不持有任何 Agent 活内存（事件队列 / HNSW / NapCat 网关都在 agent 进程）。
 *
 * epic #539 子 issue 4 起 console **零 DB 依赖**：napcat 数据经 `@kagami/napcat-api`、
 * llm_chat_call 经 `@kagami/llm-api`、agent 持有的 app_log / inner_thought / todo 经
 * `@kagami/agent-api` 的契约查询路由，各拨数据属主服务；console 本身不打开任何 SQLite。
 */
export async function buildConsoleRuntime(): Promise<ConsoleRuntime> {
  const config = await loadStaticConfig();

  const napcatQueryClient = createClient(napcatApiContract, {
    baseUrl: `http://${config.services.napcat.host}:${String(config.services.napcat.port)}`,
  });
  const llmQueryClient = createClient(llmApiContract, {
    baseUrl: `http://${config.services.llm.host}:${String(config.services.llm.port)}`,
  });
  const agentOpsQueryClient = createClient(agentApiContract, {
    baseUrl: `http://${config.services.agent.host}:${String(config.services.agent.port)}`,
  });

  const appLogQueryService = new DefaultAppLogQueryService({ agentOpsQueryClient });
  const llmChatCallQueryService = new DefaultLlmChatCallQueryService({
    llmQueryClient,
  });
  const innerThoughtQueryService = new DefaultInnerThoughtQueryService({
    agentOpsQueryClient,
  });
  const napcatEventQueryService = new DefaultNapcatEventQueryService({
    napcatQueryClient,
  });
  const napcatQqMessageQueryService = new DefaultNapcatQqMessageQueryService({
    napcatQueryClient,
  });
  const todoQueryService = new DefaultTodoQueryService({ agentOpsQueryClient });

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
      new TodoHandler({ todoQueryService }),
    ],
  });

  return { app, port: config.services.console.port };
}
