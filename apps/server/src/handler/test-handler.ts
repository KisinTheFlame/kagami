import type { FastifyInstance } from "fastify";
import { AgentRunRequestSchema, AgentRunResponseSchema } from "@kagami/shared";
import type { AgentLoop } from "../agent/agent-loop.js";

type TestHandlerDeps = {
  agentLoop: AgentLoop;
};

export class TestHandler {
  public readonly prefix = "/test";
  private readonly agentLoop: AgentLoop;

  public constructor({ agentLoop }: TestHandlerDeps) {
    this.agentLoop = agentLoop;
  }

  public register(app: FastifyInstance): void {
    app.post(`${this.prefix}/agent`, async request => {
      const payload = AgentRunRequestSchema.parse(request.body);
      const result = await this.agentLoop.run(payload);
      return AgentRunResponseSchema.parse(result);
    });
  }
}
