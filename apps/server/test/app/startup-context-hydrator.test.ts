import { beforeAll, describe, expect, it, vi } from "vitest";
import { hydrateStartupContextFromRecentMessages } from "../../src/app/startup-context-hydrator.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

beforeAll(() => {
  initTestLoggerRuntime();
});

describe("startupContextHydrator", () => {
  it("should fetch recent messages for the configured groups and hydrate the root runtime", async () => {
    const getRecentGroupMessages = vi.fn().mockImplementation(async ({ groupId }) => {
      if (groupId === "group-1") {
        return [
          {
            groupId: "group-1",
            userId: "10001",
            nickname: "群友A",
            rawMessage: "hello-1",
            messageSegments: [],
            messageId: 2,
            time: 1710000001,
          },
        ];
      }

      return [
        {
          groupId: "group-2",
          userId: "10002",
          nickname: "群友B",
          rawMessage: "hello-2",
          messageSegments: [],
          messageId: 1,
          time: 1710000000,
        },
      ];
    });
    const hydrateStartupEvents = vi.fn().mockResolvedValue(undefined);

    await hydrateStartupContextFromRecentMessages({
      listenGroupIds: ["group-1", "group-2"],
      startupContextRecentMessageCount: 40,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn(),
        getRecentGroupMessages,
      },
      rootAgentRuntime: {
        hydrateStartupEvents,
      } as never,
    });

    expect(getRecentGroupMessages).toHaveBeenCalledTimes(2);
    expect(hydrateStartupEvents).toHaveBeenCalledTimes(1);
    expect(hydrateStartupEvents).toHaveBeenCalledWith([
      {
        type: "napcat_group_message",
        data: expect.objectContaining({
          groupId: "group-2",
          rawMessage: "hello-2",
        }),
      },
      {
        type: "napcat_group_message",
        data: expect.objectContaining({
          groupId: "group-1",
          rawMessage: "hello-1",
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
        getGroupInfo: vi.fn(),
        getRecentGroupMessages,
      },
      rootAgentRuntime: {
        hydrateStartupEvents,
      } as never,
    });

    expect(getRecentGroupMessages).not.toHaveBeenCalled();
    expect(hydrateStartupEvents).not.toHaveBeenCalled();
  });

  it("should log and continue when startup hydration fetch fails", async () => {
    const getRecentGroupMessages = vi.fn().mockRejectedValueOnce(new Error("boom"));
    const hydrateStartupEvents = vi.fn().mockResolvedValue(undefined);

    await hydrateStartupContextFromRecentMessages({
      listenGroupIds: ["group-1"],
      startupContextRecentMessageCount: 40,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn(),
        getRecentGroupMessages,
      },
      rootAgentRuntime: {
        hydrateStartupEvents,
      } as never,
    });

    expect(getRecentGroupMessages).toHaveBeenCalledTimes(1);
    expect(hydrateStartupEvents).toHaveBeenCalledWith([]);
  });
});
