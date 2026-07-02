import type { FastifyInstance } from "fastify";
import { HealthQuerySchema, HealthResponseSchema } from "@kagami/shared/schemas/health";
import { createHealthResponse } from "@kagami/shared/utils";
import { registerQueryRoute } from "@kagami/http/route";

/**
 * 全服务统一的 `GET /health`（`{ status: "ok", timestamp }`，shared 的 HealthResponseSchema）。
 * 各 Fastify 服务共用这一份，监控探活对所有进程拿到同一形状；勿再各自复制。
 */
export class HealthHandler {
  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: "/health",
      querySchema: HealthQuerySchema,
      responseSchema: HealthResponseSchema,
      execute: () => {
        return createHealthResponse();
      },
    });
  }
}
