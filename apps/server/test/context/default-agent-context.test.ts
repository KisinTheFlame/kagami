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

  it("should render structured group message events into snapshot messages", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendEvents([
      {
        type: "napcat_group_message",
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
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<message>\n测试昵称 (654321):\nhello structured\n</message>",
        },
      ],
    });
  });

  it("should fallback to rawMessage when structured segments are empty", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    await context.appendEvents([
      {
        type: "napcat_group_message",
        groupId: "123456",
        userId: "654321",
        nickname: "测试昵称",
        rawMessage: "raw fallback",
        messageSegments: [],
        messageId: 1001,
        time: 1710000000,
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<message>\n测试昵称 (654321):\nraw fallback\n</message>",
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
        messageId: 1002,
        time: 1710000001,
      },
    ]);

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<message>\n测试昵称 (654321):\n@714457117 hi\n</message>",
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
