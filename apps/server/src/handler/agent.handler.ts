import type { FastifyInstance } from "fastify";
import {
  AgentEventEnqueueRequestSchema,
  AgentEventEnqueueResponseSchema,
} from "@kagami/shared";
import type { AgentEventQueue } from "../agent/event-queue.js";

type AgentHandlerDeps = {
  eventQueue: AgentEventQueue;
};

export class AgentHandler {
  public readonly prefix = "/agent";
  private readonly eventQueue: AgentEventQueue;

  public constructor({ eventQueue }: AgentHandlerDeps) {
    this.eventQueue = eventQueue;
  }

  public register(app: FastifyInstance): void {
    app.post(`${this.prefix}/event`, async (request, reply) => {
      const payload = AgentEventEnqueueRequestSchema.parse(request.body);
      const queued = this.eventQueue.enqueue({ message: payload.message });
      const response = AgentEventEnqueueResponseSchema.parse({
        accepted: true,
        queued,
      });

      return reply.code(202).send(response);
    });
  }
}
