import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp, type ServiceErrorHandler } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { HttpOssClient } from "../acl/oss-client.js";
import { GbaService } from "../application/gba.service.js";
import { RetroemuCore } from "../emulator/retroemu-core.js";
import { GbaStore } from "../persistence/gba-store.js";
import { GbaHandler } from "../http/gba.handler.js";
import { loadGbaServiceConfig } from "./config.js";

const logger = new AppLogger({ source: "gba-service-bootstrap" });

export type GbaServiceRuntime = {
  app: FastifyInstance;
  port: number;
  /** 关停：中止在途 press、flush 电池存档、释放核心、关库。 */
  shutdown: () => Promise<void>;
};

/**
 * kagami-gba 进程运行时装配。独立 PM2 进程：内嵌 mGBA WASM 核心（retroemu）+ 自有 sqlite
 * 元数据库（data/gba）+ OSS 存 ROM 字节。与 agent 完全隔离，agent 经 HttpGbaClient 直连。
 */
export async function buildGbaServiceRuntime(): Promise<GbaServiceRuntime> {
  const config = await loadGbaServiceConfig();

  mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(config.dbPath);
  const store = new GbaStore({ db });
  const ossClient = new HttpOssClient({ baseUrl: config.ossBaseUrl });
  const service = new GbaService({
    store,
    ossClient,
    coreFactory: () => new RetroemuCore(),
  });
  await service.init();

  // 统一错误出口：请求参数不合法 → 400；其余 → 500。localhost 内部 RPC，保留原始 message 便于排查。
  const errorHandler: ServiceErrorHandler = (error, request, reply) => {
    if (error instanceof z.ZodError) {
      logger.warn("GBA service request validation failed", {
        event: "gba_service.http.validation_failed",
        method: request.method,
        url: request.url,
        issues: error.issues,
      });
      return reply.code(400).send({ error: { message: "请求参数不合法", statusCode: 400 } });
    }
    logger.errorWithCause("Unhandled gba service request error", error, {
      event: "gba_service.http.unhandled_error",
      method: request.method,
      url: request.url,
    });
    return reply.code(500).send({
      error: {
        message: error instanceof Error ? error.message : "GBA 服务内部错误",
        statusCode: 500,
      },
    });
  };

  const app = createServiceApp({
    logger,
    fastifyOptions: {
      // ROM 上传上限（content-length 声明超限早拒；chunked 由 handler 的 readAllWithCap 兜底）。
      bodyLimit: config.maxBodyBytes,
    },
    errorHandler,
    configure: fastify => {
      // 只给 octet-stream 注册透传 parser：uploadRom 的裸字节流走它，JSON 路由不受影响
      // （全局 useRawBodyPassthrough 会弄坏同实例的 JSON body 解析，见 @kagami/http register.ts）。
      fastify.addContentTypeParser("application/octet-stream", (_request, payload, done) => {
        done(null, payload);
      });
    },
    handlers: [new HealthHandler(), new GbaHandler({ service })],
  });

  return {
    app,
    port: config.port,
    shutdown: async () => {
      await service.shutdown();
      db.close();
    },
  };
}
