import { describe, expect, it, vi } from "vitest";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import {
  createConversationSummaryMessage,
  createWakeReminderMessage,
} from "../../src/agent/runtime/context/context-message-factory.js";
import type { LlmMessage } from "../../src/llm/types.js";

describe("DefaultAgentContext", () => {
  it("should append plain messages into the context", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([
      createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
      {
        role: "user",
        content: "<qq_message>\n测试昵称 (654321):\nhello\n</qq_message>",
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\nhello\n</qq_message>",
        },
      ],
    });
  });

  it("should append assistant turns and tool results", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendAssistantTurn({
      role: "assistant",
      content: "reply",
      toolCalls: [],
    });
    await context.appendToolResult({
      toolCallId: "tool-1",
      content: "tool-result",
    });

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "assistant",
          content: "reply",
          toolCalls: [],
        },
        {
          role: "tool",
          toolCallId: "tool-1",
          content: "tool-result",
        },
      ],
    });
  });

  it("should render structured group message events into snapshot messages", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendEvents([
      {
        type: "napcat_group_message",
        data: {
          groupId: "123456",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "hello",
          messageSegments: [
            {
              type: "text",
              data: {
                text: "hello structured",
              },
            },
          ],
          messageId: 1001,
          time: 1710000000,
        },
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\nhello structured\n</qq_message>",
        },
      ],
    });
  });

  it("should ignore group message events when structured segments are empty", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendEvents([
      {
        type: "napcat_group_message",
        data: {
          groupId: "123456",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "raw fallback",
          messageSegments: [],
          messageId: 1001,
          time: 1710000000,
        },
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [],
    });
  });

  it("should ignore face segments in rendered snapshot messages", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendEvents([
      {
        type: "napcat_group_message",
        data: {
          groupId: "123456",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "前[CQ:face,id=66]后",
          messageSegments: [
            {
              type: "text",
              data: {
                text: "前",
              },
            },
            {
              type: "face",
              data: {
                id: "66",
                raw: {
                  faceIndex: 66,
                },
                resultId: null,
                chainCount: null,
              },
            },
            {
              type: "text",
              data: {
                text: "后",
              },
            },
          ],
          messageId: 1002,
          time: 1710000001,
        },
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\n前后\n</qq_message>",
        },
      ],
    });
  });

  it("should reset to the original system prompt source and clear messages", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "latest-system-prompt",
    });

    const legacySnapshot = {
      systemPrompt: "persisted-system-prompt",
      messages: [
        {
          role: "user",
          content: "old-message",
        },
      ] satisfies LlmMessage[],
    };

    await context.restorePersistedSnapshot(legacySnapshot);

    await context.reset();

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "latest-system-prompt",
      messages: [],
    });
  });

  it("should keep group message events when only unsupported segments are present", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendEvents([
      {
        type: "napcat_group_message",
        data: {
          groupId: "123456",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "",
          messageSegments: [
            {
              type: "face",
              data: {
                id: "66",
                raw: {
                  faceIndex: 66,
                },
                resultId: null,
                chainCount: null,
              },
            },
          ],
          messageId: 1003,
          time: 1710000002,
        },
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\n\n</qq_message>",
        },
      ],
    });
  });

  it("should render at segments without name by using qq instead of unknown", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendEvents([
      {
        type: "napcat_group_message",
        data: {
          groupId: "123456",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "[CQ:at,qq=714457117] hi",
          messageSegments: [
            {
              type: "at",
              data: {
                qq: "714457117",
              },
            },
            {
              type: "text",
              data: {
                text: " hi",
              },
            },
          ],
          messageId: 1004,
          time: 1710000003,
        },
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\n@714457117 hi\n</qq_message>",
        },
      ],
    });
  });

  it("should replace messages when external compaction finishes", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([
      createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
      {
        role: "user",
        content: "<qq_message>\n测试昵称 (654321):\nhello\n</qq_message>",
      },
    ]);
    await context.replaceMessages([
      createConversationSummaryMessage("旧上下文摘要"),
      {
        role: "assistant",
        content: "reply",
        toolCalls: [],
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createConversationSummaryMessage("旧上下文摘要"),
        {
          role: "assistant",
          content: "reply",
          toolCalls: [],
        },
      ],
    });
  });

  it("should keep messages immutable from snapshot callers", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z"))]);
    const snapshot = await context.getSnapshot();
    snapshot.messages.push({
      role: "user",
      content: "mutated",
    });

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z"))],
    });
  });

  it("should fork current snapshot into an isolated child context", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([
      createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
      {
        role: "user",
        content: "<qq_message>\n测试昵称 (654321):\nhello\n</qq_message>",
      },
    ]);

    const forkedContext = await context.fork();

    await expect(forkedContext.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\nhello\n</qq_message>",
        },
      ],
    });

    await forkedContext.appendToolResult({
      toolCallId: "tool-1",
      content: "forked-tool-result",
    });
    await context.appendMessages([
      {
        role: "assistant",
        content: "parent-reply",
        toolCalls: [],
      },
    ]);

    await expect(forkedContext.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\nhello\n</qq_message>",
        },
        {
          role: "tool",
          toolCallId: "tool-1",
          content: "forked-tool-result",
        },
      ],
    });
    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\nhello\n</qq_message>",
        },
        {
          role: "assistant",
          content: "parent-reply",
          toolCalls: [],
        },
      ],
    });
  });

  it("should capture the resolved system prompt value when forking", async () => {
    const systemPromptFactory = vi
      .fn<() => string>()
      .mockReturnValueOnce("system-prompt-v1")
      .mockReturnValue("system-prompt-v2");
    const context = new DefaultAgentContext({
      systemPromptFactory,
    });

    const forkedContext = await context.fork();

    await expect(forkedContext.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt-v1",
      messages: [],
    });
    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt-v2",
      messages: [],
    });
  });

  it("should expose dashboard summary with truncated recent items", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([
      {
        role: "user",
        content: "第一条很长很长的用户消息，需要被截断显示",
      },
      {
        role: "assistant",
        content: "assistant response that is also quite long",
        toolCalls: [],
      },
      {
        role: "tool",
        toolCallId: "tool-1",
        content: "tool result payload",
      },
    ]);

    await expect(
      context.getDashboardSummary({
        limit: 2,
        previewLength: 12,
      }),
    ).resolves.toEqual({
      messageCount: 3,
      recentItemsTruncated: true,
      recentItems: [
        {
          kind: "llm_message",
          label: "Assistant",
          preview: "assistant r…",
          truncated: true,
        },
        {
          kind: "llm_message",
          label: "工具结果 tool-1",
          preview: "tool result…",
          truncated: true,
        },
      ],
    });
  });

  it("should export and restore persisted snapshot", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const sectionedSummary = ["## 当前状态", "群里正在讨论权限", "## 待处理", "等下一轮接话"].join(
      "\n",
    );

    await context.appendMessages([
      createConversationSummaryMessage(sectionedSummary),
      {
        role: "assistant",
        content: "reply-after-summary",
        toolCalls: [],
      },
    ]);

    const exported = await context.exportPersistedSnapshot();
    expect(exported).toEqual({
      messages: [
        createConversationSummaryMessage(sectionedSummary),
        {
          role: "assistant",
          content: "reply-after-summary",
          toolCalls: [],
        },
      ],
    });

    const restored = new DefaultAgentContext({
      systemPromptFactory: () => "other-system-prompt",
    });
    await restored.restorePersistedSnapshot(exported);

    await expect(restored.getSnapshot()).resolves.toEqual({
      systemPrompt: "other-system-prompt",
      messages: [
        createConversationSummaryMessage(sectionedSummary),
        {
          role: "assistant",
          content: "reply-after-summary",
          toolCalls: [],
        },
      ],
    });

    await restored.appendToolResult({
      toolCallId: "tool-restored",
      content: "ok",
    });

    await expect(restored.getSnapshot()).resolves.toEqual({
      systemPrompt: "other-system-prompt",
      messages: [
        createConversationSummaryMessage(sectionedSummary),
        {
          role: "assistant",
          content: "reply-after-summary",
          toolCalls: [],
        },
        {
          role: "tool",
          toolCallId: "tool-restored",
          content: "ok",
        },
      ],
    });
  });
});
