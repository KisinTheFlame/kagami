import { describe, expect, it } from "vitest";
import { DefaultAgentContext } from "../../src/context/default-agent-context.js";
import {
  createConversationSummaryMessage,
  createWakeReminderMessage,
} from "../../src/context/context-message-factory.js";

describe("DefaultAgentContext", () => {
  it("should append plain messages into the context", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([
      createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
      {
        role: "user",
        content: "<message>\n测试昵称 (654321):\nhello\n</message>",
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<message>\n测试昵称 (654321):\nhello\n</message>",
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

  it("should replace messages when external compaction finishes", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendMessages([
      createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
      {
        role: "user",
        content: "<message>\n测试昵称 (654321):\nhello\n</message>",
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
});
