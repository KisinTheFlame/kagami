import type { FastifyInstance } from "fastify";
import { HealthResponseSchema, createHealthResponse, z } from "@kagami/shared";
import { registerQueryRoute } from "./route.helper.js";

const HealthQuerySchema = z.object({}).passthrough();

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
