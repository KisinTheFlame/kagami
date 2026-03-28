import { beforeAll, describe, expect, it, vi } from "vitest";
import { hydrateStartupContextFromRecentMessages } from "../../src/app/startup-context-hydrator.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

beforeAll(() => {
  initTestLoggerRuntime();
});

describe("startupContextHydrator", () => {
  it("should fetch recent messages for each group and hydrate the matching runtime", async () => {
    const getRecentGroupMessages = vi
      .fn()
      .mockResolvedValueOnce([
        {
          groupId: "group-1",
          userId: "10001",
          nickname: "群友A",
          rawMessage: "hello-1",
          messageSegments: [],
          messageId: 1,
          time: 1710000000,
        },
      ])
      .mockResolvedValueOnce([
        {
          groupId: "group-2",
          userId: "10002",
          nickname: "群友B",
          rawMessage: "hello-2",
          messageSegments: [],
          messageId: 2,
          time: 1710000001,
        },
      ]);
    const hydrateStartupEvents = vi.fn().mockResolvedValue(undefined);

    await hydrateStartupContextFromRecentMessages({
      listenGroupIds: ["group-1", "group-2"],
      startupContextRecentMessageCount: 40,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getRecentGroupMessages,
      },
      agentRuntimeManager: {
        hydrateStartupEvents,
      } as never,
    });

    expect(getRecentGroupMessages).toHaveBeenNthCalledWith(1, {
      groupId: "group-1",
      count: 40,
    });
    expect(getRecentGroupMessages).toHaveBeenNthCalledWith(2, {
      groupId: "group-2",
      count: 40,
    });
    expect(hydrateStartupEvents).toHaveBeenNthCalledWith(1, "group-1", [
      {
        type: "napcat_group_message",
        data: expect.objectContaining({
          groupId: "group-1",
          rawMessage: "hello-1",
        }),
      },
    ]);
    expect(hydrateStartupEvents).toHaveBeenNthCalledWith(2, "group-2", [
      {
        type: "napcat_group_message",
        data: expect.objectContaining({
          groupId: "group-2",
          rawMessage: "hello-2",
        }),
      },
    ]);
  });

  it("should skip fetching when startup hydration is disabled", async () => {
    const getRecentGroupMessages = vi.fn();
    const hydrateStartupEvents = vi.fn();

    await hydrateStartupContextFromRecentMessages({
      listenGroupIds: ["group-1"],
      startupContextRecentMessageCount: 0,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getRecentGroupMessages,
      },
      agentRuntimeManager: {
        hydrateStartupEvents,
      } as never,
    });

    expect(getRecentGroupMessages).not.toHaveBeenCalled();
    expect(hydrateStartupEvents).not.toHaveBeenCalled();
  });

  it("should continue hydrating later groups when one group fetch fails", async () => {
    const getRecentGroupMessages = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([
        {
          groupId: "group-2",
          userId: "10002",
          nickname: "群友B",
          rawMessage: "recovered",
          messageSegments: [],
          messageId: 2,
          time: 1710000001,
        },
      ]);
    const hydrateStartupEvents = vi.fn().mockResolvedValue(undefined);

    await hydrateStartupContextFromRecentMessages({
      listenGroupIds: ["group-1", "group-2"],
      startupContextRecentMessageCount: 40,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getRecentGroupMessages,
      },
      agentRuntimeManager: {
        hydrateStartupEvents,
      } as never,
    });

    expect(getRecentGroupMessages).toHaveBeenCalledTimes(2);
    expect(hydrateStartupEvents).toHaveBeenCalledTimes(1);
    expect(hydrateStartupEvents).toHaveBeenCalledWith("group-2", [
      {
        type: "napcat_group_message",
        data: expect.objectContaining({
          groupId: "group-2",
          rawMessage: "recovered",
        }),
      },
    ]);
  });
});
