import type { FastifyInstance } from "fastify";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createServiceApp } from "@kagami/kernel/http/service-app";
import { HealthHandler } from "@kagami/kernel/http/health.handler";
import { SaveStore } from "../persistence/save-store.js";
import { PixelService } from "../application/pixel.service.js";
import { PixelHandler } from "../http/pixel.handler.js";
import { loadPixelServiceConfig } from "./config.js";

const logger = new AppLogger({ source: "pixel-service-bootstrap" });

export type PixelServiceRuntime = {
  app: FastifyInstance;
  port: number;
  /** 关停时排空存档写队列（SaveStore 写串行链）。 */
  flushSaves: () => Promise<void>;
};

/**
 * kagami-pixel 进程运行时装配。独立 PM2 进程，持有内存画布 + JSON 存档，纯像素画后端。
 * 无 DB、无 LLM 依赖——与 agent 完全隔离（agent 重启不丢画布，issue #365）。
 *
 * 用 createServiceApp 默认错误处理器：领域拒绝走 CanvasResponse 的 { ok:false }（200），
 * 只有请求参数不合法（ZodError → 400）和意外 500 才落到默认出口。
 */
export async function buildPixelServiceRuntime(): Promise<PixelServiceRuntime> {
  const { port, saveDir } = await loadPixelServiceConfig();

  const store = new SaveStore({ dir: saveDir });
  const service = new PixelService({ store });
  await service.init();

  const app = createServiceApp({
    logger,
    handlers: [new HealthHandler(), new PixelHandler({ service })],
  });

  return { app, port, flushSaves: () => service.flush() };
}
