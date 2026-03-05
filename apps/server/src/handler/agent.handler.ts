import type { FastifyInstance } from "fastify";
import { AgentEventEnqueueRequestSchema, AgentEventEnqueueResponseSchema } from "@kagami/shared";
import type { AgentEventQueue } from "../agent/event-queue.js";
import { AppLogger } from "../logger/logger.js";

type AgentHandlerDeps = {
  eventQueue: AgentEventQueue;
};

const logger = new AppLogger({ source: "handler.agent" });

export class AgentHandler {
  public readonly prefix = "/agent";
  private readonly eventQueue: AgentEventQueue;

  public constructor({ eventQueue }: AgentHandlerDeps) {
    this.eventQueue = eventQueue;
  }

  public register(app: FastifyInstance): void {
    app.post(`${this.prefix}/event`, async (request, reply) => {
      logger.info("Received agent event enqueue request", {
        event: "agent.event.enqueue.request_received",
      });

      try {
        const payload = AgentEventEnqueueRequestSchema.parse(request.body);
        const queued = this.eventQueue.enqueue({ message: payload.message });

        logger.info("Agent event enqueued", {
          event: "agent.event.enqueue.accepted",
          queued,
          messageLength: payload.message.length,
        });

        const response = AgentEventEnqueueResponseSchema.parse({
          accepted: true,
          queued,
        });

        return reply.code(202).send(response);
      } catch (error) {
        logger.errorWithCause("Failed to enqueue agent event", error, {
          event: "agent.event.enqueue.failed",
        });
        throw error;
      }
    });
  }
}
