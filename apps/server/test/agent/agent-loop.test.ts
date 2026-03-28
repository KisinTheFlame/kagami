import { describe, expect, it, vi } from "vitest";
import { AgentLoop } from "../../src/agent/agents/main-engine/agent-loop.js";
import { DefaultAgentContext } from "../../src/agent/context/default-agent-context.js";
import {
  createConversationSummaryMessage,
  createWakeReminderMessage,
} from "../../src/agent/context/context-message-factory.js";
import type { AgentEventQueue } from "../../src/agent/event/event.queue.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload } from "../../src/llm/types.js";
import { ToolCatalog } from "../../src/agent/tools/index.js";
import type { ToolComponent, ToolSet } from "../../src/agent/tools/index.js";
import type { LoopRunRecorder } from "../../src/agent/service/loop-run-recorder.service.js";

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
  sendMessageExecute?: ReturnType<typeof vi.fn>;
}): {
  agentTools: ToolSet;
  finishExecute: ReturnType<typeof vi.fn>;
  searchWebExecute: ReturnType<typeof vi.fn>;
  sendMessageExecute: ReturnType<typeof vi.fn>;
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
  const sendMessageExecute =
    overrides?.sendMessageExecute ??
    vi.fn().mockResolvedValue({
      content: "",
      signal: "continue",
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
      name: "send_message",
      description: "send",
      parameters: { type: "object", properties: {} },
      kind: "business",
      llmTool: {
        name: "send_message",
        description: "send",
        parameters: { type: "object", properties: {} },
      },
      execute: sendMessageExecute,
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
    agentTools: new ToolCatalog(components).pick(["search_web", "send_message", "finish"]),
    finishExecute,
    searchWebExecute,
    sendMessageExecute,
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
    const { agentTools, finishExecute, searchWebExecute, sendMessageExecute } = createAgentTools({
      searchWebExecute: vi.fn(),
      sendMessageExecute: vi.fn(),
    });

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
            content: "<qq_message>\n测试昵称 (654321):\nhello world\n</qq_message>",
          },
        ],
        tools: agentTools.definitions(),
        toolChoice: "required",
      },
      expect.objectContaining({
        usage: "agent",
      }),
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
            content: "<qq_message>\n测试昵称 (654321):\nhello world\n</qq_message>",
          },
        ],
      },
    );
    expect(searchWebExecute).not.toHaveBeenCalled();
    expect(sendMessageExecute).not.toHaveBeenCalled();
    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\nhello world\n</qq_message>",
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

  it("should record loop run timeline for main agent loop", async () => {
    const stopError = new StopLoopError("stop-loop");
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-23T01:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-03-23T01:00:01.000Z"))
      .mockReturnValueOnce(new Date("2026-03-23T01:00:02.000Z"))
      .mockReturnValueOnce(new Date("2026-03-23T01:00:03.000Z"))
      .mockReturnValue(new Date("2026-03-23T01:00:03.000Z"));
    const { agentTools } = createAgentTools({
      finishExecute: vi.fn().mockResolvedValue({
        content: JSON.stringify({ ok: true }),
        signal: "finish_round",
      }),
    });
    const loopRunRecorder = {
      startRun: vi.fn().mockResolvedValue("loop-1"),
      recordLlmCall: vi.fn().mockResolvedValue(undefined),
      recordToolCall: vi.fn().mockResolvedValue(undefined),
      recordToolResult: vi.fn().mockResolvedValue(undefined),
      finishRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as LoopRunRecorder;

    const llmClient: LlmClient = {
      chat: vi.fn(async (_request, options) => {
        await options.onSettled?.({
          requestId: "req-1",
          loopRunId: "loop-1",
          provider: "openai",
          model: "gpt-test",
          request: {
            messages: [],
            tools: [],
            toolChoice: "required",
          },
          response: {
            provider: "openai",
            model: "gpt-test",
            message: {
              role: "assistant",
              content: "done",
              toolCalls: [{ id: "tool-call-1", name: "finish", arguments: {} }],
            },
          },
          error: null,
          latencyMs: 1000,
          startedAt: new Date("2026-03-23T01:00:00.000Z"),
          finishedAt: new Date("2026-03-23T01:00:01.000Z"),
          status: "success",
        });

        return createLlmResponse();
      }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      drainAll: vi
        .fn()
        .mockReturnValueOnce([createGroupEvent("hello world")])
        .mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
      waitForEvent: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(stopError),
    };
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });

    const loop = new AgentLoop({
      llmClient,
      context,
      eventQueue,
      agentTools,
      now,
      loopRunRecorder,
    });

    await expect(loop.run()).rejects.toBe(stopError);

    expect(loopRunRecorder.startRun).toHaveBeenCalledWith({
      event: expect.objectContaining({
        rawMessage: "hello world",
      }),
      startedAt: new Date("2026-03-23T01:00:01.000Z"),
    });
    expect(loopRunRecorder.recordLlmCall).toHaveBeenCalledWith({
      loopRunId: "loop-1",
      seq: 1,
      observation: expect.objectContaining({
        requestId: "req-1",
        status: "success",
      }),
    });
    expect(loopRunRecorder.recordToolCall).toHaveBeenCalledWith({
      loopRunId: "loop-1",
      seq: 2,
      toolName: "finish",
      toolCallId: "tool-call-1",
      argumentsValue: {},
      startedAt: new Date("2026-03-23T01:00:02.000Z"),
    });
    expect(loopRunRecorder.recordToolResult).toHaveBeenCalledWith({
      loopRunId: "loop-1",
      seq: 3,
      toolName: "finish",
      toolCallId: "tool-call-1",
      result: expect.objectContaining({
        signal: "finish_round",
      }),
      startedAt: new Date("2026-03-23T01:00:02.000Z"),
      finishedAt: new Date("2026-03-23T01:00:03.000Z"),
    });
    expect(loopRunRecorder.finishRun).toHaveBeenCalledWith({
      loopRunId: "loop-1",
      status: "success",
      startedAt: new Date("2026-03-23T01:00:01.000Z"),
      finishedAt: new Date("2026-03-23T01:00:03.000Z"),
      outcome: {
        reason: "finish_round",
        groupId: "123456",
      },
      seq: 4,
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
      summaryPlanner,
      summaryTools: [],
      contextCompactionThreshold: 1,
      now: () => new Date("2026-03-09T10:21:00.000Z"),
    });

    await expect(loop.run()).rejects.toBe(stopError);

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
            content: "<qq_message>\n测试昵称 (654321):\nhello world\n</qq_message>",
          },
        ],
      }),
      expect.objectContaining({
        usage: "agent",
      }),
    );
  });

  it("should stop executing later tool calls after a finish_round signal", async () => {
    const stopError = new StopLoopError("stop-loop");
    const searchWebExecute = vi.fn().mockResolvedValue({
      content: "done",
      signal: "finish_round",
    });
    const sendMessageExecute = vi.fn().mockResolvedValue({
      content: "should-not-run",
      signal: "continue",
    });
    const { agentTools } = createAgentTools({
      searchWebExecute,
      sendMessageExecute,
    });
    const chat = vi.fn().mockResolvedValue({
      provider: "openai",
      model: "gpt-test",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "search-1",
            name: "search_web",
            arguments: {},
          },
          {
            id: "send-1",
            name: "send_message",
            arguments: { message: "hi" },
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

    expect(searchWebExecute).toHaveBeenCalledWith(
      {},
      {
        groupId: "123456",
        systemPrompt: "system-prompt",
        messages: [
          createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
          {
            role: "user",
            content: "<qq_message>\n测试昵称 (654321):\nhello world\n</qq_message>",
          },
        ],
      },
    );
    expect(sendMessageExecute).not.toHaveBeenCalled();
    await expect(context.getSnapshot()).resolves.toEqual({
      systemPrompt: "system-prompt",
      messages: [
        createWakeReminderMessage(new Date("2026-03-09T10:21:00.000Z")),
        {
          role: "user",
          content: "<qq_message>\n测试昵称 (654321):\nhello world\n</qq_message>",
        },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "search-1",
              name: "search_web",
              arguments: {},
            },
            {
              id: "send-1",
              name: "send_message",
              arguments: { message: "hi" },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "search-1",
          content: "done",
        },
      ],
    });
  });
});
