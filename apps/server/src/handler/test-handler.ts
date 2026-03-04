import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentLoop } from "../agent/agent-loop.js";

const AgentRequestSchema = z.object({
  input: z.string().min(1),
  maxSteps: z.coerce.number().int().positive().max(8).optional(),
});

export class TestHandler {
  public readonly prefix = "/test";

  public constructor(private readonly agentLoop: AgentLoop) {}

  public register(app: FastifyInstance): void {
    app.post(`${this.prefix}/agent`, async request => {
      const payload = AgentRequestSchema.parse(request.body);
      return this.agentLoop.run(payload);
    });
  }
}
