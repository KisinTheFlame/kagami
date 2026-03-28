import type { FastifyInstance } from "fastify";
import { HealthQuerySchema, HealthResponseSchema } from "@kagami/shared/schemas/health";
import { createHealthResponse } from "@kagami/shared/utils";
import { registerQueryRoute } from "../../common/http/route.helper.js";

export class HealthHandler {
  public readonly prefix = "";

  public register(app: FastifyInstance): void {
    registerQueryRoute({
      app,
      path: `${this.prefix}/health`,
      querySchema: HealthQuerySchema,
      responseSchema: HealthResponseSchema,
      execute: () => {
        return createHealthResponse();
      },
    });
  }
}
