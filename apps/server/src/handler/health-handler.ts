import type { FastifyInstance } from "fastify";
import { HealthResponseSchema, createHealthResponse } from "@kagami/shared";

export class HealthHandler {
  public readonly prefix = "";

  public register(app: FastifyInstance): void {
    app.get(`${this.prefix}/health`, async () => {
      const response = createHealthResponse();
      return HealthResponseSchema.parse(response);
    });
  }
}
