import { describe, expect, it, vi } from "vitest";
import { InMemoryAgentEventQueue } from "../../src/agent/event/event.impl.queue.js";
import { MultiGroupAgentRuntimeManager } from "../../src/agent/agents/main-engine/index.js";

describe("MultiGroupAgentRuntimeManager", () => {
  it("should route events to the matching group queue only", () => {
    const groupOneQueue = new InMemoryAgentEventQueue();
    const groupTwoQueue = new InMemoryAgentEventQueue();
    const manager = new MultiGroupAgentRuntimeManager({
      runtimes: [
        {
          groupId: "group-1",
          eventQueue: groupOneQueue,
          agentLoop: { run: vi.fn().mockResolvedValue(undefined) } as never,
        },
        {
          groupId: "group-2",
          eventQueue: groupTwoQueue,
          agentLoop: { run: vi.fn().mockResolvedValue(undefined) } as never,
        },
      ],
    });

    manager.enqueue({
      type: "napcat_group_message",
      groupId: "group-1",
      userId: "10001",
      nickname: "群友A",
      rawMessage: "hello group 1",
      messageSegments: [],
      messageId: 1,
      time: 1710000000,
    });
    manager.enqueue({
      type: "napcat_group_message",
      groupId: "group-2",
      userId: "10002",
      nickname: "群友B",
      rawMessage: "hello group 2",
      messageSegments: [],
      messageId: 2,
      time: 1710000001,
    });

    expect(groupOneQueue.drainAll()).toEqual([
      expect.objectContaining({
        groupId: "group-1",
        rawMessage: "hello group 1",
      }),
    ]);
    expect(groupTwoQueue.drainAll()).toEqual([
      expect.objectContaining({
        groupId: "group-2",
        rawMessage: "hello group 2",
      }),
    ]);
  });

  it("should reject with the crashing group id when one loop fails", async () => {
    const manager = new MultiGroupAgentRuntimeManager({
      runtimes: [
        {
          groupId: "group-1",
          eventQueue: new InMemoryAgentEventQueue(),
          agentLoop: {
            run: vi.fn().mockImplementation(async () => await new Promise<void>(() => undefined)),
          } as never,
        },
        {
          groupId: "group-2",
          eventQueue: new InMemoryAgentEventQueue(),
          agentLoop: {
            run: vi.fn().mockRejectedValue(new Error("boom")),
          } as never,
        },
      ],
    });

    await expect(manager.run()).rejects.toThrow("group-2");
  });
});
