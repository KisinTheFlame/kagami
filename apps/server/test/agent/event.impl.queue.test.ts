import { describe, expect, it } from "vitest";
import { InMemoryAgentEventQueue } from "../../src/agent/runtime/event/in-memory-agent-event-queue.js";

describe("InMemoryAgentEventQueue", () => {
  it("should support enqueue, drainAll and size with group message event", () => {
    const queue = new InMemoryAgentEventQueue();

    expect(queue.size()).toBe(0);

    const sizeAfterEnqueue = queue.enqueue({
      type: "napcat_group_message",
      groupId: "10001",
      userId: "20002",
      nickname: "测试昵称",
      rawMessage: "hello",
      messageSegments: [],
      messageId: 30003,
      time: 1710000000,
    });

    expect(sizeAfterEnqueue).toBe(1);
    expect(queue.size()).toBe(1);
    expect(queue.drainAll()).toEqual([
      {
        type: "napcat_group_message",
        groupId: "10001",
        userId: "20002",
        nickname: "测试昵称",
        rawMessage: "hello",
        messageSegments: [],
        messageId: 30003,
        time: 1710000000,
      },
    ]);
    expect(queue.size()).toBe(0);
    expect(queue.drainAll()).toEqual([]);
  });

  it("should resolve waitForEvent immediately when queue is not empty", async () => {
    const queue = new InMemoryAgentEventQueue();
    queue.enqueue({
      type: "napcat_group_message",
      groupId: "10001",
      userId: "20002",
      nickname: "测试昵称",
      rawMessage: "already-queued",
      messageSegments: [],
      messageId: 30003,
      time: 1710000000,
    });

    await expect(queue.waitForEvent()).resolves.toBeUndefined();
  });

  it("should resolve waitForEvent after enqueue when queue is empty", async () => {
    const queue = new InMemoryAgentEventQueue();
    const waitPromise = queue.waitForEvent();

    queue.enqueue({
      type: "napcat_group_message",
      groupId: "10001",
      userId: "20002",
      nickname: "测试昵称",
      rawMessage: "later",
      messageSegments: [],
      messageId: 30003,
      time: 1710000000,
    });

    await expect(waitPromise).resolves.toBeUndefined();
    expect(queue.drainAll()).toEqual([
      {
        type: "napcat_group_message",
        groupId: "10001",
        userId: "20002",
        nickname: "测试昵称",
        rawMessage: "later",
        messageSegments: [],
        messageId: 30003,
        time: 1710000000,
      },
    ]);
  });
});
