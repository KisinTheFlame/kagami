import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventQueue } from "../../src/agent/event-queue.queue.js";
import { AgentHandler } from "../../src/handler/agent.handler.js";
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

  it("should enqueue event using injected queue dependency", async () => {
    const enqueue = vi.fn().mockReturnValue(2);
    const eventQueue: AgentEventQueue = {
      enqueue,
      drainAll: vi.fn().mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
      waitForEvent: vi.fn().mockResolvedValue(undefined),
    };

    const handler = new AgentHandler({ eventQueue });
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
    expect(enqueue).toHaveBeenCalledWith({ message: "hello" });
  });
});
