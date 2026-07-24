import { describe, expect, it, vi } from "vitest";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import {
  createConversationSummaryMessage,
  createWakeReminderMessage,
} from "../../src/agent/runtime/context/context-message-factory.js";
import type { LlmMessage } from "@kagami/llm-client";

describe("DefaultAgentContext", () => {
  it("bumps revision on mutations and leaves it unchanged on reads", async () => {
    const context = new DefaultAgentContext({ systemPromptFactory: () => "sp" });

    const r0 = context.getRevision();
    // 只读操作不改修订号。
    await context.getSnapshot();
    await context.getDashboardSummary();
    expect(context.getRevision()).toBe(r0);

    // 每次实际改动 items 都 +1。
    await context.appendMessages([{ role: "user", content: "a" }]);
    const r1 = context.getRevision();
    expect(r1).toBeGreaterThan(r0);

    // 空 append 不算改动，不 +1。
    await context.appendMessages([]);
    expect(context.getRevision()).toBe(r1);

    await context.appendAssistantTurn({ role: "assistant", content: "", toolCalls: [] });
    await context.appendToolResult({ toolCallId: "t1", content: "ok" });
    await context.reset();
    // 三次改动后修订号严格递增。
    expect(context.getRevision()).toBeGreaterThan(r1 + 2);
  });

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

  it("should replace the entire context when leading count covers all messages", async () => {
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
    // count=2 覆盖全部 message，等价于整条重建。
    await context.replaceLeadingMessages(2, [
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

  it("should replace only the leading prefix and keep the tail", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([
      { role: "user", content: "old-1" },
      { role: "user", content: "old-2" },
      { role: "user", content: "keep-me" },
    ]);
    // 只替换前 2 条，保留尾部 keep-me。
    await context.replaceLeadingMessages(2, [createConversationSummaryMessage("摘要")]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [createConversationSummaryMessage("摘要"), { role: "user", content: "keep-me" }],
    });
  });

  it("replaces the leading count of messages (item 与 message 1:1 对齐)", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([
      { role: "user", content: "old" },
      { role: "user", content: "keep-me" },
    ]);

    // count=1 替换最前一条 old，keep-me 保留。
    await context.replaceLeadingMessages(1, [createConversationSummaryMessage("摘要")]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [createConversationSummaryMessage("摘要"), { role: "user", content: "keep-me" }],
    });
  });

  it("should throw when leading count exceeds total messages", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([{ role: "user", content: "only-one" }]);

    await expect(context.replaceLeadingMessages(2, [])).rejects.toThrow(
      /超过 context 总 message 数/,
    );
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
