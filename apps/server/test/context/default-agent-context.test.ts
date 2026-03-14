import { describe, expect, it, vi } from "vitest";
import { DefaultAgentContext } from "../../src/context/default-agent-context.js";

describe("DefaultAgentContext", () => {
  it("should record a wake reminder in user messages", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    context.recordWake({
      now: new Date("2026-03-09T10:21:00.000Z"),
    });

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<system_reminder>当前时间为北京时间 2026 年 3 月 9 日 18:21</system_reminder>",
        },
      ],
    });
  });

  it("should insert enriched messages after the current group message", async () => {
    const eventEnricher = {
      enrichAfterEvent: vi.fn().mockResolvedValue([
        {
          role: "user",
          content: [
            "<memory_history_message>",
            "时间：2026-03-11 10:00:00",
            "</memory_history_message>",
          ].join("\n"),
        },
      ]),
    };
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
      eventEnricher,
    });

    await context.recordEvent({
      type: "napcat_group_message",
      groupId: "123456",
      userId: "654321",
      nickname: "测试昵称",
      rawMessage: "hello",
      messageId: 1001,
      time: 1710000000,
    });

    const snapshot = await context.getSnapshot();
    expect(snapshot.messages).toEqual([
      {
        role: "user",
        content: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
      },
      {
        role: "user",
        content: [
          "<memory_history_message>",
          "时间：2026-03-11 10:00:00",
          "</memory_history_message>",
        ].join("\n"),
      },
    ]);
    expect(eventEnricher.enrichAfterEvent).toHaveBeenCalledWith({
      event: {
        type: "napcat_group_message",
        groupId: "123456",
        userId: "654321",
        nickname: "测试昵称",
        rawMessage: "hello",
        messageId: 1001,
        time: 1710000000,
      },
      snapshot: {
        systemPrompt: "system-prompt",
        messages: [
          {
            role: "user",
            content: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
          },
        ],
      },
    });
  });

  it("should not append a wake reminder when the formatted time has not changed", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    context.recordWake({
      now: new Date("2026-03-09T10:21:00.000Z"),
    });
    context.recordWake({
      now: new Date("2026-03-09T10:21:59.000Z"),
    });

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<system_reminder>当前时间为北京时间 2026 年 3 月 9 日 18:21</system_reminder>",
        },
      ],
    });
  });

  it("should append a new wake reminder when the formatted minute changes", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    context.recordWake({
      now: new Date("2026-03-09T10:21:00.000Z"),
    });
    context.recordWake({
      now: new Date("2026-03-09T10:22:00.000Z"),
    });

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<system_reminder>当前时间为北京时间 2026 年 3 月 9 日 18:21</system_reminder>",
        },
        {
          role: "user",
          content: "<system_reminder>当前时间为北京时间 2026 年 3 月 9 日 18:22</system_reminder>",
        },
      ],
    });
  });

  it("should dedupe against the latest wake reminder even when other messages are appended later", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    context.recordWake({
      now: new Date("2026-03-09T10:21:00.000Z"),
    });
    await context.recordEvent({
      type: "napcat_group_message",
      groupId: "123456",
      userId: "654321",
      nickname: "测试昵称",
      rawMessage: "hello",
      messageId: 1001,
      time: 1710000000,
    });
    context.recordWake({
      now: new Date("2026-03-09T10:21:59.000Z"),
    });

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<system_reminder>当前时间为北京时间 2026 年 3 月 9 日 18:21</system_reminder>",
        },
        {
          role: "user",
          content: ["<message>", "测试昵称 (654321):", "hello", "</message>"].join("\n"),
        },
      ],
    });
  });

  it("should keep messages immutable from snapshot callers", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    context.recordWake({
      now: new Date("2026-03-09T10:21:00.000Z"),
    });
    const snapshot = await context.getSnapshot();
    snapshot.messages.push({
      role: "user",
      content: "mutated",
    });

    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        {
          role: "user",
          content: "<system_reminder>当前时间为北京时间 2026 年 3 月 9 日 18:21</system_reminder>",
        },
      ],
    });
  });
});
