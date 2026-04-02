import { describe, expect, it, vi } from "vitest";
import type { StoryLoopAgent } from "../../src/agent/capabilities/story/runtime/story-agent.runtime.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import type { RootLoopAgent } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { DefaultAgentDashboardQueryService } from "../../src/ops/application/agent-dashboard-query.impl.service.js";

describe("DefaultAgentDashboardQueryService", () => {
  it("should compose root and story agent dashboard snapshots", async () => {
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
          focusedStateId: "portal",
          focusedStateDisplayName: "门户",
          focusedStateDescription: "主入口",
          stateStack: [{ id: "portal", displayName: "门户" }],
          children: [
            {
              id: "qq_group:group-1",
              displayName: "QQ 群 产品群 (group-1)",
              description: "未读 3 条消息。",
            },
          ],
          waiting: {
            active: true,
            deadlineAt: new Date("2026-03-30T08:01:00.000Z"),
            resumeStateId: "qq_group:group-1",
          },
          availableInvokeTools: [],
        },
        availableInvokeTools: [],
      }),
    };
    const storyAgentRuntime: Pick<StoryLoopAgent, "getDashboardSnapshot"> = {
      getDashboardSnapshot: vi.fn().mockResolvedValue({
        initialized: true,
        loopState: "idle",
        lastError: {
          name: "BizError",
          message: "临时失败",
          updatedAt: new Date("2026-03-30T08:00:01.000Z"),
        },
        lastActivityAt: new Date("2026-03-30T08:00:02.000Z"),
        lastRoundCompletedAt: new Date("2026-03-30T08:00:00.000Z"),
        lastCompactionAt: new Date("2026-03-30T07:58:00.000Z"),
        contextCompactionTotalTokenThreshold: 150_000,
        contextSummary: {
          messageCount: 4,
          recentItems: [
            {
              kind: "llm_message",
              label: "Assistant",
              preview: "story summary",
              truncated: false,
            },
          ],
          recentItemsTruncated: false,
        },
        lastToolCall: {
          name: "create_story",
          argumentsPreview:
            '{"markdown":"# 权限交接吐槽\\n- 时间：今天\\n- 场景：群聊\\n- 人物：Alice\\n- 影响：审批链路继续拖慢交接\\n\\n起因：继续吐槽流程\\n经过：\\n1. 提到 CEO 审批\\n结果：觉得流程离谱"}',
          updatedAt: new Date("2026-03-30T08:00:00.500Z"),
        },
        lastToolResultPreview: '{"ok":true}',
        lastLlmCall: {
          provider: "openai",
          model: "gpt-4o-mini",
          assistantContentPreview: "整理成记忆",
          toolCallNames: ["create_story"],
          totalTokens: 321,
          updatedAt: new Date("2026-03-30T08:00:00.400Z"),
        },
        story: {
          lastProcessedMessageSeq: 22,
          pendingMessageCount: 5,
          pendingBatch: {
            firstSeq: 23,
            lastSeq: 24,
          },
          batchSize: 10,
          idleFlushMs: 60_000,
        },
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
      storyAgentRuntime: storyAgentRuntime as StoryLoopAgent,
      eventQueue,
      listAvailableAgentProviders: vi.fn().mockResolvedValue([
        {
          id: "openai",
          models: ["gpt-4o-mini"],
        },
      ]),
    });

    const snapshot = await service.getCurrentSnapshot();

    expect(snapshot.agents).toEqual([
      {
        id: "root",
        label: "主 Agent",
        kind: "root",
        runtime: {
          initialized: true,
          loopState: "waiting",
          lastError: null,
          lastActivityAt: "2026-03-30T08:00:00.000Z",
          lastRoundCompletedAt: "2026-03-30T07:59:58.000Z",
          lastCompactionAt: "2026-03-30T07:55:00.000Z",
        },
        session: {
          focusedStateId: "portal",
          focusedStateDisplayName: "门户",
          focusedStateDescription: "主入口",
          stateStack: [{ id: "portal", displayName: "门户" }],
          children: [
            {
              id: "qq_group:group-1",
              displayName: "QQ 群 产品群 (group-1)",
              description: "未读 3 条消息。",
            },
          ],
          availableInvokeTools: [],
          waiting: {
            active: true,
            deadlineAt: "2026-03-30T08:01:00.000Z",
            resumeStateId: "qq_group:group-1",
          },
        },
        queue: {
          pendingEventCount: 2,
        },
        context: {
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
        },
        activity: {
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
        },
        providers: [
          {
            id: "openai",
            models: ["gpt-4o-mini"],
          },
        ],
      },
      {
        id: "story",
        label: "Story Agent",
        kind: "story",
        runtime: {
          initialized: true,
          loopState: "idle",
          lastError: {
            name: "BizError",
            message: "临时失败",
            updatedAt: "2026-03-30T08:00:01.000Z",
          },
          lastActivityAt: "2026-03-30T08:00:02.000Z",
          lastRoundCompletedAt: "2026-03-30T08:00:00.000Z",
          lastCompactionAt: "2026-03-30T07:58:00.000Z",
        },
        context: {
          messageCount: 4,
          compactionTotalTokenThreshold: 150_000,
          recentItems: [
            {
              kind: "llm_message",
              label: "Assistant",
              preview: "story summary",
              truncated: false,
            },
          ],
          recentItemsTruncated: false,
        },
        activity: {
          lastToolCall: {
            name: "create_story",
            argumentsPreview:
              '{"markdown":"# 权限交接吐槽\\n- 时间：今天\\n- 场景：群聊\\n- 人物：Alice\\n- 影响：审批链路继续拖慢交接\\n\\n起因：继续吐槽流程\\n经过：\\n1. 提到 CEO 审批\\n结果：觉得流程离谱"}',
            updatedAt: "2026-03-30T08:00:00.500Z",
          },
          lastToolResultPreview: '{"ok":true}',
          lastLlmCall: {
            provider: "openai",
            model: "gpt-4o-mini",
            assistantContentPreview: "整理成记忆",
            toolCallNames: ["create_story"],
            totalTokens: 321,
            updatedAt: "2026-03-30T08:00:00.400Z",
          },
        },
        story: {
          lastProcessedMessageSeq: 22,
          pendingMessageCount: 5,
          pendingBatch: {
            firstSeq: 23,
            lastSeq: 24,
          },
          batchSize: 10,
          idleFlushMs: 60_000,
        },
      },
    ]);
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
