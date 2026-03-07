import { describe, expect, it } from "vitest";
import { InMemoryAgentEventQueue } from "../../src/agent/event-queue.impl.queue.js";

describe("InMemoryAgentEventQueue", () => {
  it("should support enqueue, drainAll and size with message event", () => {
    const queue = new InMemoryAgentEventQueue();

    expect(queue.size()).toBe(0);

    const sizeAfterEnqueue = queue.enqueue({
      type: "message",
      message: "hello",
    });

    expect(sizeAfterEnqueue).toBe(1);
    expect(queue.size()).toBe(1);
    expect(queue.drainAll()).toEqual([
      {
        type: "message",
        message: "hello",
      },
    ]);
    expect(queue.size()).toBe(0);
    expect(queue.drainAll()).toEqual([]);
  });

  it("should resolve waitForEvent immediately when queue is not empty", async () => {
    const queue = new InMemoryAgentEventQueue();
    queue.enqueue({
      type: "message",
      message: "already-queued",
    });

    await expect(queue.waitForEvent()).resolves.toBeUndefined();
  });

  it("should resolve waitForEvent after enqueue when queue is empty", async () => {
    const queue = new InMemoryAgentEventQueue();
    const waitPromise = queue.waitForEvent();

    queue.enqueue({
      type: "message",
      message: "later",
    });

    await expect(waitPromise).resolves.toBeUndefined();
    expect(queue.drainAll()).toEqual([
      {
        type: "message",
        message: "later",
      },
    ]);
  });
});
