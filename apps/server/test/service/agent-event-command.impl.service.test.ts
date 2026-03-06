import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventQueue } from "../../src/agent/event-queue.queue.js";
import { DefaultAgentEventCommandService } from "../../src/service/agent-event-command.impl.service.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

describe("DefaultAgentEventCommandService", () => {
  beforeEach(() => {
    initTestLoggerRuntime();
  });

  it("should enqueue event and return accepted response", () => {
    const enqueue = vi.fn().mockReturnValue(3);
    const eventQueue: AgentEventQueue = {
      enqueue,
      drainAll: vi.fn().mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
      waitForEvent: vi.fn().mockResolvedValue(undefined),
    };
    const service = new DefaultAgentEventCommandService({ eventQueue });

    const response = service.enqueueEvent({ message: "hello" });

    expect(response).toEqual({
      accepted: true,
      queued: 3,
    });
    expect(enqueue).toHaveBeenCalledWith({ message: "hello" });
  });
});
