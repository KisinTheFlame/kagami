import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHandler } from "../../src/handler/agent.handler.js";
import type { AgentEventCommandService } from "../../src/service/agent-event-command.service.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

describe("AgentHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    initTestLoggerRuntime();
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should enqueue event using injected command service", async () => {
    const enqueueEvent = vi.fn().mockReturnValue({
      accepted: true as const,
      queued: 2,
    });
    const agentEventCommandService: AgentEventCommandService = {
      enqueueEvent,
    };

    const handler = new AgentHandler({ agentEventCommandService });
    handler.register(app);

    const response = await app.inject({
      method: "POST",
      url: "/agent/event",
      payload: { message: "hello" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      accepted: true,
      queued: 2,
    });
    expect(enqueueEvent).toHaveBeenCalledWith({ message: "hello" });
  });
});
