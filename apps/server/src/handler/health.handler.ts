import type { FastifyInstance } from "fastify";
import { HealthQuerySchema, HealthResponseSchema, createHealthResponse } from "@kagami/shared";
import { registerQueryRoute } from "./route.helper.js";

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
