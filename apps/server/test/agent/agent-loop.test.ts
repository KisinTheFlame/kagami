import { describe, expect, it, vi } from "vitest";
import { AgentLoop } from "../../src/agents/main-engine/agent-loop.js";
import type { RagContextEventEnricher } from "../../src/agents/subagents/rag/rag-context-event-enricher.js";
import { DefaultAgentContext } from "../../src/context/default-agent-context.js";
import {
  createConversationSummaryMessage,
  createWakeReminderMessage,
} from "../../src/context/context-message-factory.js";
import type { AgentEventQueue } from "../../src/event/event.queue.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload } from "../../src/llm/types.js";
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
  trySendMessageExecute?: ReturnType<typeof vi.fn>;
}): {
  agentTools: ToolSet;
  finishExecute: ReturnType<typeof vi.fn>;
  searchWebExecute: ReturnType<typeof vi.fn>;
  trySendMessageExecute: ReturnType<typeof vi.fn>;
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
  const trySendMessageExecute =
    overrides?.trySendMessageExecute ??
    vi.fn().mockResolvedValue({
      content: "",
      signal: "finish_round",
    });

  const components: ToolComponent[] = [
    {
      name: "search_web",
      description: "search",
      parameters: { type: "object", properties: {} },
      kind: "business",
      llmTool: {
        name: "search_web",
        description: "search",
        parameters: { type: "object", properties: {} },
      },
      execute: searchWebExecute,
    },
    {
      name: "try_send_message",
      description: "send",
      parameters: { type: "object", properties: {} },
      kind: "business",
      llmTool: {
        name: "try_send_message",
        description: "send",
        parameters: { type: "object", properties: {} },
      },
      execute: trySendMessageExecute,
    },
    {
      name: "finish",
      description: "finish",
      parameters: { type: "object", properties: {} },
      kind: "control",
      llmTool: {
        name: "finish",
        description: "finish",
        parameters: { type: "object", properties: {} },
      },
      execute: finishExecute,
    },
  ];

  return {
    agentTools: new ToolCatalog(components).pick(["search_web", "try_send_message", "finish"]),
    finishExecute,
    searchWebExecute,
    trySendMessageExecute,
  };
}

function createGroupEvent(
  message: string,
  overrides?: Partial<{
    groupId: string;
    userId: string;
    nickname: string;
    messageId: number | null;
    time: number | null;
    messageSegments: Array<{ type: "text"; data: { text: string } }>;
  }>,
) {
  return {
    type: "napcat_group_message" as const,
    groupId: overrides?.groupId ?? "123456",
    userId: overrides?.userId ?? "654321",
    nickname: overrides?.nickname ?? "测试昵称",
    rawMessage: message,
    messageSegments: overrides?.messageSegments ?? [
      {
        type: "text" as const,
        data: {
          text: message,
        },
      },
    ],
    messageId: overrides?.messageId ?? 1001,
    time: overrides?.time ?? 1710000000,
  };
}

describe("AgentLoop", () => {
  it("should consume queue events and execute one enabled tool round", async () => {
    const stopError = new StopLoopError("stop-loop");
    const now = vi.fn().mockReturnValue(new Date("2026-03-09T10:21:00.000Z"));
    const { agentTools, finishExecute, searchWebExecute, trySendMessageExecute } = createAgentTools(
      {
        searchWebExecute: vi.fn(),
        trySendMessageExecute: vi.fn(),
      },
    );

    const chat = vi.fn().mockResolvedValue(createLlmResponse());
    const llmClient: LlmClient = {
      chat,
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    const waitForEvent = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(stopError);
    const drainAll = vi
      .fn()
      .mockReturnValueOnce([createGroupEvent("hello world")])
      .mockReturnValue([]);
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      drainAll,
      size: vi.fn().mockReturnValue(0),
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

    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(
      {
        system: "system-prompt",
        messages: [
          createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
          {
            role: "user",
            content: "<message>\n测试昵称 (654321):\nhello world\n</message>",
          },
        ],
        tools: agentTools.definitions(),
        toolChoice: "required",
      },
      {
        usage: "agent",
      },
    );
    expect(finishExecute).toHaveBeenCalledWith(
      {},
      {
        groupId: "123456",
        systemPrompt: "system-prompt",
        messages: [
          createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
          {
            role: "user",
            content: "<message>\n测试昵称 (654321):\nhello world\n</message>",
          },
        ],
      },
    );
    expect(searchWebExecute).not.toHaveBeenCalled();
    expect(trySendMessageExecute).not.toHaveBeenCalled();
    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<message>\n测试昵称 (654321):\nhello world\n</message>",
        },
        {
          role: "assistant",
          content: "done",
          toolCalls: [],
        },
      ],
    });
  });

  it("should add a wake reminder each time the loop resumes from sleep", async () => {
    const stopError = new StopLoopError("stop-loop");
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-09T10:21:00.000Z"))
      .mockReturnValueOnce(new Date("2026-03-09T10:22:00.000Z"));
    const { agentTools } = createAgentTools();
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

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
        chat: vi.fn().mockResolvedValue(createLlmResponse()),
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn().mockResolvedValue([]),
      },
      context,
      eventQueue,
      agentTools,
      now,
    });

    await expect(loop.run()).rejects.toBe(stopError);

    const snapshot = await context.getSnapshot();
    expect(snapshot.messages).toEqual(
      expect.arrayContaining([
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        createWakeReminderMessage(new Date("2026-03-09T10:22:00.000Z")),
      ]),
    );
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

    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      drainAll: vi
        .fn()
        .mockReturnValueOnce([createGroupEvent("hello world")])
        .mockReturnValueOnce([
          createGroupEvent("world wide", {
            messageId: 1002,
            time: 1710000001,
          }),
        ])
        .mockReturnValue([]),
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

  it("should enrich and compact context inside the loop instead of inside context", async () => {
    const stopError = new StopLoopError("stop-loop");
    const chat = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-test",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "finish-1", name: "finish", arguments: {} }],
      },
    } satisfies LlmChatResponsePayload);
    const llmClient: LlmClient = {
      chat,
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const ragContextEventEnricher = {
      enrichAfterEvents: vi.fn().mockResolvedValue([
        {
          role: "user",
          content: "<memory_history_message>\n时间：2026-03-11 10:00:00\n</memory_history_message>",
        },
      ]),
    } as const;
    const summaryPlanner = {
      summarize: vi.fn().mockResolvedValue("累计摘要"),
    };
    const { agentTools } = createAgentTools();
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      drainAll: vi
        .fn()
        .mockReturnValueOnce([createGroupEvent("hello world")])
        .mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
      waitForEvent: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(stopError),
    };

    const loop = new AgentLoop({
      llmClient,
      context,
      eventQueue,
      agentTools,
      ragContextEventEnricher: ragContextEventEnricher as unknown as RagContextEventEnricher,
      summaryPlanner,
      summaryTools: [],
      contextCompactionThreshold: 1,
      now: () => new Date("2026-03-09T10:21:00.000Z"),
    });

    await expect(loop.run()).rejects.toBe(stopError);

    expect(ragContextEventEnricher.enrichAfterEvents).toHaveBeenCalledWith({
      events: [createGroupEvent("hello world")],
      snapshot: {
        systemPrompt: "system-prompt",
        messages: [
          createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
          {
            role: "user",
            content: "<message>\n测试昵称 (654321):\nhello world\n</message>",
          },
        ],
      },
    });
    expect(summaryPlanner.summarize).toHaveBeenCalledWith({
      messages: [createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z"))],
      tools: [],
    });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          createConversationSummaryMessage("累计摘要"),
          {
            role: "user",
            content: "<message>\n测试昵称 (654321):\nhello world\n</message>",
          },
          {
            role: "user",
            content:
              "<memory_history_message>\n时间：2026-03-11 10:00:00\n</memory_history_message>",
          },
        ],
      }),
      {
        usage: "agent",
      },
    );
  });

  it("should stop executing later tool calls after a finish_round signal", async () => {
    const stopError = new StopLoopError("stop-loop");
    const trySendMessageExecute = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        sent: false,
      }),
      signal: "finish_round",
    });
    const searchWebExecute = vi.fn().mockResolvedValue({
      content: "should-not-run",
      signal: "continue",
    });
    const { agentTools } = createAgentTools({
      trySendMessageExecute,
      searchWebExecute,
    });
    const chat = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-test",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "try-send-1",
            name: "try_send_message",
            arguments: {},
          },
          {
            id: "search-1",
            name: "search_web",
            arguments: {},
          },
        ],
      },
    } satisfies LlmChatResponsePayload);
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      drainAll: vi
        .fn()
        .mockReturnValueOnce([createGroupEvent("hello world")])
        .mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
      waitForEvent: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(stopError),
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
      now: () => new Date("2026-03-09T10:21:00.000Z"),
    });

    await expect(loop.run()).rejects.toBe(stopError);

    expect(trySendMessageExecute).toHaveBeenCalledWith(
      {},
      {
        groupId: "123456",
        systemPrompt: "system-prompt",
        messages: [
          createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
          {
            role: "user",
            content: "<message>\n测试昵称 (654321):\nhello world\n</message>",
          },
        ],
      },
    );
    expect(searchWebExecute).not.toHaveBeenCalled();
    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<message>\n测试昵称 (654321):\nhello world\n</message>",
        },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "try-send-1",
              name: "try_send_message",
              arguments: {},
            },
            {
              id: "search-1",
              name: "search_web",
              arguments: {},
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "try-send-1",
          content: JSON.stringify({
            sent: false,
          }),
        },
      ],
    });
  });
});
