import type { FastifyInstance } from "fastify";
import { createHealthResponse, HealthQuerySchema, HealthResponseSchema } from "@kagami/http/wire";
import { registerQueryRoute } from "@kagami/http/route";

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
