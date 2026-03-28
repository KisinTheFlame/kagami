import { describe, expect, it } from "vitest";
import { InMemoryAgentEventQueue } from "../../src/agent/runtime/event/in-memory-agent-event-queue.js";

describe("InMemoryAgentEventQueue", () => {
  it("should support enqueue, dequeue and size with group message event", () => {
    const queue = new InMemoryAgentEventQueue();

    expect(queue.size()).toBe(0);

    const sizeAfterEnqueue = queue.enqueue({
      type: "napcat_group_message",
      data: {
        groupId: "10001",
        userId: "20002",
        nickname: "测试昵称",
        rawMessage: "hello",
        messageSegments: [],
        messageId: 30003,
        time: 1710000000,
      },
    });

    expect(sizeAfterEnqueue).toBe(1);
    expect(queue.size()).toBe(1);
    expect(queue.dequeue()).toEqual({
      type: "napcat_group_message",
      data: {
        groupId: "10001",
        userId: "20002",
        nickname: "测试昵称",
        rawMessage: "hello",
        messageSegments: [],
        messageId: 30003,
        time: 1710000000,
      },
    });
    expect(queue.size()).toBe(0);
    expect(queue.dequeue()).toBeNull();
  });

  it("should dequeue in FIFO order", () => {
    const queue = new InMemoryAgentEventQueue();
    queue.enqueue({
      type: "napcat_group_message",
      data: {
        groupId: "10001",
        userId: "20002",
        nickname: "测试昵称",
        rawMessage: "already-queued",
        messageSegments: [],
        messageId: 30003,
        time: 1710000000,
      },
    });
    queue.enqueue({
      type: "napcat_group_message",
      data: {
        groupId: "10001",
        userId: "20002",
        nickname: "测试昵称",
        rawMessage: "later",
        messageSegments: [],
        messageId: 30004,
        time: 1710000000,
      },
    });

    expect(queue.dequeue()).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          rawMessage: "already-queued",
          messageId: 30003,
        }),
      }),
    );
    expect(queue.dequeue()).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          rawMessage: "later",
          messageId: 30004,
        }),
      }),
    );
    expect(queue.dequeue()).toBeNull();
  });
});
