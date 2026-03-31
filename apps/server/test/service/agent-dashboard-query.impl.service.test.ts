import { describe, expect, it, vi } from "vitest";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import type { RootLoopAgent } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { DefaultAgentDashboardQueryService } from "../../src/ops/application/agent-dashboard-query.impl.service.js";

describe("DefaultAgentDashboardQueryService", () => {
  it("should compose a full agent dashboard snapshot", async () => {
    const rootAgentRuntime: Pick<RootLoopAgent, "getDashboardSnapshot"> = {
      getDashboardSnapshot: vi.fn().mockResolvedValue({
        initialized: true,
        loopState: "waiting",
        lastError: null,
        lastActivityAt: new Date("2026-03-30T08:00:00.000Z"),
        lastRoundCompletedAt: new Date("2026-03-30T07:59:58.000Z"),
        lastCompactionAt: new Date("2026-03-30T07:55:00.000Z"),
        contextCompactionTotalTokenThreshold: 150_000,
        contextSummary: {
          messageCount: 12,
          recentItems: [
            {
              kind: "llm_message",
              label: "用户消息",
              preview: "最近一条消息",
              truncated: false,
            },
          ],
          recentItemsTruncated: true,
        },
        lastToolCall: {
          name: "wait",
          argumentsPreview: '{"minutes":1}',
          updatedAt: new Date("2026-03-30T07:59:59.000Z"),
        },
        lastToolResultPreview: '{"ok":true}',
        lastLlmCall: {
          provider: "openai",
          model: "gpt-4o-mini",
          assistantContentPreview: "正在等待",
          toolCallNames: ["wait"],
          totalTokens: 12_345,
          updatedAt: new Date("2026-03-30T07:59:59.000Z"),
        },
        session: {
          state: {
            kind: "waiting",
            deadlineAt: new Date("2026-03-30T08:01:00.000Z"),
          },
          currentGroupId: null,
          waitingDeadlineAt: new Date("2026-03-30T08:01:00.000Z"),
          availableInvokeTools: [],
          groups: [
            {
              groupId: "group-1",
              groupName: "产品群",
              unreadCount: 3,
              hasEntered: true,
            },
          ],
        },
        availableInvokeTools: [],
      }),
    };
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn(),
      dequeue: vi.fn(),
      size: vi.fn().mockReturnValue(2),
      clear: vi.fn().mockReturnValue(0),
    };
    const service = new DefaultAgentDashboardQueryService({
      rootAgentRuntime: rootAgentRuntime as RootLoopAgent,
      eventQueue,
      listenGroupIds: ["group-1"],
      listAvailableAgentProviders: vi.fn().mockResolvedValue([
        {
          id: "openai",
          models: ["gpt-4o-mini"],
        },
      ]),
    });

    const snapshot = await service.getCurrentSnapshot();

    expect(snapshot.runtime).toEqual({
      initialized: true,
      loopState: "waiting",
      lastError: null,
      lastActivityAt: "2026-03-30T08:00:00.000Z",
      lastRoundCompletedAt: "2026-03-30T07:59:58.000Z",
      lastCompactionAt: "2026-03-30T07:55:00.000Z",
    });
    expect(snapshot.session).toEqual({
      kind: "waiting",
      currentGroupId: null,
      waitingDeadlineAt: "2026-03-30T08:01:00.000Z",
      availableInvokeTools: [],
    });
    expect(snapshot.queue).toEqual({
      pendingEventCount: 2,
    });
    expect(snapshot.groups).toEqual([
      {
        groupId: "group-1",
        groupName: "产品群",
        unreadCount: 3,
        hasEntered: true,
      },
    ]);
    expect(snapshot.context).toEqual({
      messageCount: 12,
      compactionTotalTokenThreshold: 150_000,
      recentItems: [
        {
          kind: "llm_message",
          label: "用户消息",
          preview: "最近一条消息",
          truncated: false,
        },
      ],
      recentItemsTruncated: true,
    });
    expect(snapshot.activity).toEqual({
      lastToolCall: {
        name: "wait",
        argumentsPreview: '{"minutes":1}',
        updatedAt: "2026-03-30T07:59:59.000Z",
      },
      lastToolResultPreview: '{"ok":true}',
      lastLlmCall: {
        provider: "openai",
        model: "gpt-4o-mini",
        assistantContentPreview: "正在等待",
        toolCallNames: ["wait"],
        totalTokens: 12_345,
        updatedAt: "2026-03-30T07:59:59.000Z",
      },
    });
    expect(snapshot.providers).toEqual([
      {
        id: "openai",
        models: ["gpt-4o-mini"],
      },
    ]);
    expect(snapshot.config).toEqual({
      listenGroupIds: ["group-1"],
    });
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
