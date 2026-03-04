import type { FastifyInstance } from "fastify";
import { AgentRunRequestSchema, AgentRunResponseSchema } from "@kagami/shared";
import type { AgentLoop } from "../agent/agent-loop.js";

export class TestHandler {
  public readonly prefix = "/test";

  public constructor(private readonly agentLoop: AgentLoop) {}

  public register(app: FastifyInstance): void {
    app.post(`${this.prefix}/agent`, async request => {
      const payload = AgentRunRequestSchema.parse(request.body);
      const result = await this.agentLoop.run(payload);
      return AgentRunResponseSchema.parse(result);
    });
  }
}
