import type { AgentEventEnqueueRequest, AgentEventEnqueueResponse } from "@kagami/shared";
import type { AgentEventQueue } from "../agent/event-queue.queue.js";
import { AppLogger } from "../logger/logger.js";
import type { AgentEventCommandService } from "./agent-event-command.service.js";

type DefaultAgentEventCommandServiceDeps = {
  eventQueue: AgentEventQueue;
};

const logger = new AppLogger({ source: "service.agent-event-command" });

export class DefaultAgentEventCommandService implements AgentEventCommandService {
  private readonly eventQueue: AgentEventQueue;

  public constructor({ eventQueue }: DefaultAgentEventCommandServiceDeps) {
    this.eventQueue = eventQueue;
  }

  public enqueueEvent(payload: AgentEventEnqueueRequest): AgentEventEnqueueResponse {
    logger.info("Received agent event enqueue request", {
      event: "agent.event.enqueue.request_received",
    });

    const queued = this.eventQueue.enqueue({ message: payload.message });

    logger.info("Agent event enqueued", {
      event: "agent.event.enqueue.accepted",
      queued,
      messageLength: payload.message.length,
    });

    return {
      accepted: true as const,
      queued,
    };
  }
}
