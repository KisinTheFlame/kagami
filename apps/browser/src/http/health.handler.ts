import type { FastifyInstance } from "fastify";
import { HealthQuerySchema, HealthResponseSchema } from "@kagami/shared/schemas/health";
import { createHealthResponse } from "@kagami/shared/utils";
import { registerQueryRoute } from "@kagami/server-core/common/http/route.helper";

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
