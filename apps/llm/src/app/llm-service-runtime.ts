import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { configureSqlite, createDbClient, type Database } from "@kagami/persistence/db/client";
import { PrismaLlmChatCallDao } from "@kagami/persistence/dao/impl/llm-chat-call.impl.dao";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { toBizErrorWire } from "@kagami/kernel/errors/biz-error-wire";
import {
  createServiceApp,
  type AppRouteHandler,
  type ServiceErrorHandler,
} from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { createAuthModule } from "@kagami/auth";
import {
  createLlmClient,
  createDeepSeekProvider,
  createOpenAiProvider,
  createOpenAiCodexProvider,
  createClaudeCodeProvider,
  type LlmChatCallObservation,
  type LlmClient,
} from "@kagami/llm-client";
import { createEmbeddingClient, type EmbeddingClient } from "@kagami/llm-client/embedding";
import { PrismaEmbeddingCacheDao } from "../infra/prisma-embedding-cache.dao.js";
import { PrismaClaudeFileCacheDao } from "../infra/prisma-claude-file-cache.dao.js";
import { InternalLlmHandler } from "../http/internal-llm.handler.js";
import { loadLlmServiceConfig } from "./config.js";
import { startAuthRefreshTimers, type AuthRefreshTimers } from "./auth-refresh-timers.js";

const logger = new AppLogger({ source: "llm-service-bootstrap" });

export type LlmServiceRuntime = {
  app: FastifyInstance;
  database: Database;
  port: number;
  callbackServers: Array<{ stop(): Promise<void> }>;
  authRefreshTimers: AuthRefreshTimers;
};

/**
 * kagami-llm 进程运行时装配。独立 PM2 进程，持有全部 LLM provider + OAuth 凭据中心
 * （callback server 绑 1455/54545 在本进程），未来多个 Agent 进程共享它。经 @kagami/persistence
 * 直读同一 SQLite（WAL）落 llm_chat_call / 读写 auth 表 / embedding_cache。
 */
export async function buildLlmServiceRuntime(): Promise<LlmServiceRuntime> {
  const { config, configManager, databaseUrl, port } = await loadLlmServiceConfig();

  const database = createDbClient({ databaseUrl });
  // 与 agent / console 并发读写同一 SQLite 文件：开 WAL（库文件级持久设置）。
  await configureSqlite(database);

  const authModule = await createAuthModule({ database, configManager });
  const llmChatCallDao = new PrismaLlmChatCallDao({ database });
  const embeddingCacheDao = new PrismaEmbeddingCacheDao({ database });
  const claudeFileCacheDao = new PrismaClaudeFileCacheDao({ database });

  // auth service（OAuthAuthService）的 getAuth/hasCredentials 与 token 形态跟 llm-client 的凭据
  // 端口逐字段一致，直接作为 authStore 注入 provider 工厂（结构化满足接口）。
  const claudeCodeAuthStore = authModule.authServices["claude-code"];
  const codexAuthStore = authModule.authServices.codex;
  const llmTimeoutMs = config.server.llm.timeoutMs;
  const deepseekConfig = { ...config.server.llm.providers.deepseek, timeoutMs: llmTimeoutMs };
  const openAiConfig = { ...config.server.llm.providers.openai, timeoutMs: llmTimeoutMs };
  const openAiCodexConfig = { ...config.server.llm.providers.openaiCodex, timeoutMs: llmTimeoutMs };
  const claudeCodeConfig = {
    apiKey: undefined,
    ...config.server.llm.providers.claudeCode,
    timeoutMs: llmTimeoutMs,
  };
  const llmProviders = {
    deepseek: deepseekConfig.apiKey
      ? createDeepSeekProvider({ ...deepseekConfig, apiKey: deepseekConfig.apiKey })
      : undefined,
    openai: openAiConfig.apiKey
      ? createOpenAiProvider({ ...openAiConfig, apiKey: openAiConfig.apiKey })
      : undefined,
    "openai-codex": createOpenAiCodexProvider({
      config: openAiCodexConfig,
      authStore: codexAuthStore,
    }),
    "claude-code": createClaudeCodeProvider({
      config: claudeCodeConfig,
      authStore: claudeCodeAuthStore,
      fileCacheDao: claudeFileCacheDao,
    }),
  };

  // 落库在服务内：llm-client 只发 observation，这里订阅后写 llm_chat_call。返回 DAO 的
  // Promise，让 client 内部 emitObservation 统一 catch（写库失败不影响 LLM 结果）。
  const recordLlmChatObservation = (observation: LlmChatCallObservation): Promise<void> => {
    if (observation.status === "success") {
      return llmChatCallDao.recordSuccess({
        provider: observation.provider,
        model: observation.model,
        extension: observation.extension,
        requestId: observation.requestId,
        seq: observation.seq,
        latencyMs: observation.latencyMs,
        request: observation.request,
        response: observation.response,
        nativeRequestPayload: observation.nativeRequestPayload,
        nativeResponsePayload: observation.nativeResponsePayload,
      });
    }

    return llmChatCallDao.recordError({
      provider: observation.provider,
      model: observation.model,
      extension: observation.extension,
      requestId: observation.requestId,
      seq: observation.seq,
      latencyMs: observation.latencyMs,
      request: observation.request,
      ...(observation.response ? { response: observation.response } : {}),
      nativeRequestPayload: observation.nativeRequestPayload,
      nativeResponsePayload: observation.nativeResponsePayload,
      nativeError: observation.nativeError,
      error: observation.error,
    });
  };

  const llmClient: LlmClient = createLlmClient({
    providers: llmProviders,
    providerConfigs: {
      deepseek: deepseekConfig,
      openai: openAiConfig,
      "openai-codex": openAiCodexConfig,
      "claude-code": claudeCodeConfig,
    },
    usages: config.server.llm.usages,
    recordObservation: recordLlmChatObservation,
  });

  const embeddingClient: EmbeddingClient = createEmbeddingClient({
    config: config.server.llm.embedding,
    cacheDao: embeddingCacheDao,
  });

  // auth 刷新 + usage 刷新在本进程用自己的 timer 驱动（TaskScheduler 是 agent app 层，不引入）。
  const authRefreshTimers = startAuthRefreshTimers({
    refreshSchedulers: authModule.authRefreshSchedulers,
    authUsageCacheManager: authModule.authUsageCacheManager,
  });

  const app = createLlmServiceApp({
    handlers: [
      new HealthHandler(),
      new InternalLlmHandler({ llmClient, embeddingClient }),
      authModule.authHandler,
    ],
  });

  return {
    app,
    database,
    port,
    callbackServers: authModule.callbackServers,
    authRefreshTimers,
  };
}

export function createLlmServiceApp({
  handlers,
}: {
  handlers: AppRouteHandler[];
}): FastifyInstance {
  // /internal/chat 承载完整 LLM 请求：system + 整段历史 + base64 图片（单张资源可达 4 MiB，
  // 见 server.resource.maxBytes；context 阈值 60w token）。Fastify 默认 1 MB bodyLimit 远不够——
  // in-process 时没有这道限制，拆 HTTP 后必须放开，否则大请求被 413「Request body is too large」
  // 挡在 handler 之前、LLM 调用直接失败。给 100 MB 富余上限（localhost 内部 RPC，ceiling 非分配）。
  const LLM_SERVICE_BODY_LIMIT_BYTES = 100 * 1024 * 1024;

  // 统一错误出口：BizError → 富错误信封 { error: BizErrorWire }（带 meta/statusCode），
  // 让 agent 侧 HttpLlmClient 忠实重建 BizError（retry / 控制流 instanceof 语义不变）。
  // 注意：这里刻意不用默认处理器的 toHttpErrorResponse（它面向前端、只回 { message }、丢 meta）。
  const errorHandler: ServiceErrorHandler = (error, request, reply) => {
    if (error instanceof z.ZodError) {
      logger.warn("LLM service request validation failed", {
        event: "llm_service.http.validation_failed",
        method: request.method,
        url: request.url,
        issues: error.issues,
      });
      const wire = toBizErrorWire(new BizError({ message: "请求参数不合法", statusCode: 400 }));
      return reply.code(400).send({ error: wire });
    }

    if (error instanceof BizError) {
      const wire = toBizErrorWire(error);
      return reply.code(wire.statusCode >= 400 ? wire.statusCode : 500).send({ error: wire });
    }

    logger.errorWithCause("Unhandled LLM service request error", error, {
      event: "llm_service.http.unhandled_error",
      method: request.method,
      url: request.url,
    });
    // 保留原始 message（localhost 内部 RPC，无泄漏顾虑），便于 agent 侧日志排查；
    // 非 BizError 本就不在 isRetryableLlmFailure 的两条重试消息内，重试语义与原地内不变。
    const wire = toBizErrorWire(
      new BizError({
        message: error instanceof Error ? error.message : "LLM 服务内部错误",
        statusCode: 500,
      }),
    );
    return reply.code(500).send({ error: wire });
  };

  return createServiceApp({
    logger,
    handlers,
    fastifyOptions: { bodyLimit: LLM_SERVICE_BODY_LIMIT_BYTES },
    errorHandler,
  });
}
