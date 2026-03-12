import { describe, expect, it, vi } from "vitest";
import { AgentLoop } from "../../src/agent/agent-loop.js";
import type { AgentEventQueue } from "../../src/agent/event.queue.js";
import type { AgentContext } from "../../src/context/agent-context.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload, LlmMessage } from "../../src/llm/types.js";
import { ToolCatalog } from "../../src/tools/index.js";
import type { ToolComponent, ToolSet } from "../../src/tools/index.js";

class StopLoopError extends Error {}

function createLlmResponse(): LlmChatResponsePayload {
  return {
    provider: "openai",
    model: "gpt-test",
    message: {
      role: "assistant",
      content: "done",
      toolCalls: [{ id: "tool-call-1", name: "finish", arguments: {} }],
    },
  };
}

function createAgentTools(overrides?: {
  finishExecute?: ReturnType<typeof vi.fn>;
  searchWebExecute?: ReturnType<typeof vi.fn>;
  sendGroupMessageExecute?: ReturnType<typeof vi.fn>;
}): {
  agentTools: ToolSet;
  finishExecute: ReturnType<typeof vi.fn>;
  searchWebExecute: ReturnType<typeof vi.fn>;
  sendGroupMessageExecute: ReturnType<typeof vi.fn>;
} {
  const finishExecute =
    overrides?.finishExecute ??
    vi.fn().mockResolvedValue({
      content: "",
      signal: "finish_round",
    });
  const searchWebExecute =
    overrides?.searchWebExecute ??
    vi.fn().mockResolvedValue({
      content: "",
      signal: "continue",
    });
  const sendGroupMessageExecute =
    overrides?.sendGroupMessageExecute ??
    vi.fn().mockResolvedValue({
      content: "",
      signal: "continue",
    });

  const components: ToolComponent[] = [
    {
      name: "search_web",
      description: "search",
      parameters: {
        type: "object",
        properties: {},
      },
      kind: "business",
      llmTool: {
        name: "search_web",
        description: "search",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      execute: searchWebExecute,
    },
    {
      name: "send_group_message",
      description: "send",
      parameters: {
        type: "object",
        properties: {},
      },
      kind: "business",
      llmTool: {
        name: "send_group_message",
        description: "send",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      execute: sendGroupMessageExecute,
    },
    {
      name: "finish",
      description: "finish",
      parameters: {
        type: "object",
        properties: {},
      },
      kind: "control",
      llmTool: {
        name: "finish",
        description: "finish",
        parameters: {
          type: "object",
          properties: {},
        },
      },
      execute: finishExecute,
    },
  ];

  return {
    agentTools: new ToolCatalog(components).pick(["search_web", "send_group_message", "finish"]),
    finishExecute,
    searchWebExecute,
    sendGroupMessageExecute,
  };
}

describe("AgentLoop", () => {
  it("should consume queue events and execute one enabled tool round", async () => {
    const stopError = new StopLoopError("stop-loop");
    const now = vi.fn().mockReturnValue(new Date("2026-03-09T10:21:00.000Z"));
    const { agentTools, finishExecute, searchWebExecute, sendGroupMessageExecute } =
      createAgentTools({
        searchWebExecute: vi.fn(),
        sendGroupMessageExecute: vi.fn(),
      });

    const chat = vi.fn().mockResolvedValue(createLlmResponse());
    const llmClient: LlmClient = {
      chat,
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };

    const getSnapshot = vi.fn().mockResolvedValue({
      systemPrompt: "system-prompt",
      messages: [],
    });
    const recordWake = vi.fn();
    const recordEvent = vi.fn().mockResolvedValue(undefined);
    const recordAssistantTurn = vi.fn();
    const recordToolResult = vi.fn();
    const context: AgentContext = {
      getSnapshot,
      recordWake,
      recordEvent,
      recordAssistantTurn,
      recordToolResult,
    };

    const waitForEvent = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(stopError);
    const drainAll = vi
      .fn()
      .mockReturnValueOnce([
        {
          type: "napcat_group_message",
          groupId: "123456",
          userId: "654321",
          nickname: "测试昵称",
          rawMessage: "hello",
          messageId: 1001,
          time: 1710000000,
        },
      ])
      .mockReturnValue([]);
    const size = vi.fn().mockReturnValue(0);
    const enqueue = vi.fn().mockReturnValue(1);
    const eventQueue: AgentEventQueue = {
      enqueue,
      drainAll,
      size,
      waitForEvent,
    };

    const loop = new AgentLoop({
      llmClient,
      context,
      eventQueue,
      agentTools,
      now,
    });

    await expect(loop.run()).rejects.toBe(stopError);

    expect(waitForEvent).toHaveBeenCalledTimes(2);
    expect(drainAll).toHaveBeenCalled();
    expect(recordWake).toHaveBeenNthCalledWith(1, {
      now: new Date("2026-03-09T10:21:00.000Z"),
    });
    expect(recordEvent).toHaveBeenCalledWith({
      type: "napcat_group_message",
      groupId: "123456",
      userId: "654321",
      nickname: "测试昵称",
      rawMessage: "hello",
      messageId: 1001,
      time: 1710000000,
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(
      {
        system: "system-prompt",
        messages: [],
        tools: agentTools.definitions(),
        toolChoice: "required",
      },
      {
        usage: "agent",
      },
    );
    expect(recordAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "done",
        toolCalls: [],
      }),
    );
    expect(finishExecute).toHaveBeenCalledWith({}, {});
    expect(searchWebExecute).not.toHaveBeenCalled();
    expect(sendGroupMessageExecute).not.toHaveBeenCalled();
    expect(recordToolResult).not.toHaveBeenCalled();
  });

  it("should add a wake reminder each time the loop resumes from sleep", async () => {
    const stopError = new StopLoopError("stop-loop");
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-09T10:21:00.000Z"))
      .mockReturnValueOnce(new Date("2026-03-09T10:22:00.000Z"));
    const { agentTools } = createAgentTools();

    const chat = vi.fn().mockResolvedValue(createLlmResponse());
    const context: AgentContext = {
      getSnapshot: vi.fn().mockResolvedValue({
        systemPrompt: "system-prompt",
        messages: [],
      }),
      recordWake: vi.fn(),
      recordEvent: vi.fn().mockResolvedValue(undefined),
      recordAssistantTurn: vi.fn(),
      recordToolResult: vi.fn(),
    };

    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      drainAll: vi.fn().mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
      waitForEvent: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(stopError),
    };

    const loop = new AgentLoop({
      llmClient: {
        chat,
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn().mockResolvedValue([]),
      },
      context,
      eventQueue,
      agentTools,
      now,
    });

    await expect(loop.run()).rejects.toBe(stopError);

    expect(context.recordWake).toHaveBeenCalledTimes(2);
    expect(context.recordWake).toHaveBeenNthCalledWith(1, {
      now: new Date("2026-03-09T10:21:00.000Z"),
    });
    expect(context.recordWake).toHaveBeenNthCalledWith(2, {
      now: new Date("2026-03-09T10:22:00.000Z"),
    });
  });

  it("should not carry finish tool calls or responses into later chat context", async () => {
    const stopError = new StopLoopError("stop-loop");
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-09T10:21:00.000Z"))
      .mockReturnValueOnce(new Date("2026-03-09T10:22:00.000Z"));
    const { agentTools } = createAgentTools();

    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "round-1",
          toolCalls: [{ id: "finish-1", name: "finish", arguments: {} }],
        },
      } satisfies LlmChatResponsePayload)
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "round-2",
          toolCalls: [{ id: "finish-2", name: "finish", arguments: {} }],
        },
      } satisfies LlmChatResponsePayload);

    const messages: LlmMessage[] = [];
    const context: AgentContext = {
      getSnapshot: vi.fn(async () => ({
        systemPrompt: "system-prompt",
        messages: messages.slice(),
      })),
      recordWake: vi.fn(({ now }: { now: Date }) => {
        messages.push({
          role: "user",
          content: `<system_reminder>${now.toISOString()}</system_reminder>`,
        });
      }),
      recordEvent: vi.fn(async event => {
        messages.push({
          role: "user",
          content: [
            "<message>",
            `${event.nickname} (${event.userId}):`,
            event.rawMessage,
            "</message>",
          ].join("\n"),
        });
      }),
      recordAssistantTurn: vi.fn(message => {
        messages.push(message);
      }),
      recordToolResult: vi.fn(
        ({ toolCallId, content }: { toolCallId: string; content: string }) => {
          messages.push({
            role: "tool",
            toolCallId,
            content,
          });
        },
      ),
    };

    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      drainAll: vi
        .fn()
        .mockReturnValueOnce([
          {
            type: "napcat_group_message",
            groupId: "123456",
            userId: "654321",
            nickname: "测试昵称",
            rawMessage: "hello",
            messageId: 1001,
            time: 1710000000,
          },
        ])
        .mockReturnValueOnce([])
        .mockReturnValueOnce([
          {
            type: "napcat_group_message",
            groupId: "123456",
            userId: "654321",
            nickname: "测试昵称",
            rawMessage: "world",
            messageId: 1002,
            time: 1710000001,
          },
        ])
        .mockReturnValueOnce([]),
      size: vi.fn().mockReturnValue(0),
      waitForEvent: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(stopError),
    };

    const loop = new AgentLoop({
      llmClient: {
        chat,
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn().mockResolvedValue([]),
      },
      context,
      eventQueue,
      agentTools,
      now,
    });

    await expect(loop.run()).rejects.toBe(stopError);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[0]?.messages).toEqual(
      expect.arrayContaining([
        {
          role: "assistant",
          content: "round-1",
          toolCalls: [],
        },
      ]),
    );
    expect(chat.mock.calls[1]?.[0]?.messages).not.toEqual(
      expect.arrayContaining([
        {
          role: "assistant",
          content: "round-1",
          toolCalls: [{ id: "finish-1", name: "finish", arguments: {} }],
        },
      ]),
    );
    expect(chat.mock.calls[1]?.[0]?.messages).not.toEqual(
      expect.arrayContaining([
        {
          role: "tool",
          toolCallId: "finish-1",
          content: "",
        },
      ]),
    );
  });
});
