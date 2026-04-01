import { describe, expect, it, vi } from "vitest";
import { ToolCatalog, type ToolComponent } from "@kagami/agent-runtime";
import { SearchWebTool } from "../../src/agent/capabilities/web-search/tools/search-web.tool.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import {
  createConversationSummaryMessage,
  createUserMessage,
} from "../../src/agent/runtime/context/context-message-factory.js";
import { InMemoryAgentEventQueue } from "../../src/agent/runtime/event/in-memory-agent-event-queue.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import type { RootAgentRuntimeSnapshotRepository } from "../../src/agent/runtime/root-agent/persistence/root-agent-runtime-snapshot.repository.js";
import { RootLoopAgent } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { BackToPortalTool } from "../../src/agent/runtime/root-agent/tools/back-to-portal.tool.js";
import { EnterTool } from "../../src/agent/runtime/root-agent/tools/enter.tool.js";
import { WaitTool } from "../../src/agent/runtime/root-agent/tools/wait.tool.js";
import { BizError } from "../../src/common/errors/biz-error.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmMessage, Tool } from "../../src/llm/types.js";
import type { PersistedRootAgentRuntimeSnapshot } from "../../src/agent/runtime/root-agent/persistence/root-agent-runtime-snapshot.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

class StopLoopError extends Error {}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createGroupEvent(message: string, groupId = "group-1") {
  return {
    type: "napcat_group_message" as const,
    data: {
      groupId,
      userId: "654321",
      nickname: "测试昵称",
      rawMessage: message,
      messageSegments: [
        {
          type: "text" as const,
          data: {
            text: message,
          },
        },
      ],
      messageId: 1001,
      time: 1710000000,
    },
  };
}

function createGroupHistoryMessage(message: string, groupId = "group-1") {
  return {
    groupId,
    userId: "123456",
    nickname: "历史群友",
    rawMessage: message,
    messageSegments: [
      {
        type: "text" as const,
        data: {
          text: message,
        },
      },
    ],
    messageId: 2001,
    time: 1710000100,
  };
}

function createRuntimeForCompactionTest(input: {
  context: DefaultAgentContext;
  contextSummaryOperation?: {
    summarize(input: { messages: LlmMessage[]; tools: Tool[] }): Promise<string | null>;
  };
  contextCompactionTotalTokenThreshold: number;
  completions?: Awaited<ReturnType<LlmClient["chat"]>>[];
  llmRetryBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const session = new RootAgentSession({
    context: input.context,
    napcatGatewayService: {
      start: vi.fn(),
      stop: vi.fn(),
      sendGroupMessage: vi.fn(),
      getGroupInfo: vi.fn().mockResolvedValue({
        groupId: "group-1",
        groupName: "产品群",
        memberCount: 123,
        maxMemberCount: 500,
        groupRemark: "",
        groupAllShut: false,
      }),
      getRecentGroupMessages: vi.fn().mockResolvedValue([]),
    },
    listenGroupIds: ["group-1"],
    recentMessageLimit: 0,
  });
  const eventQueue: AgentEventQueue = {
    enqueue: vi.fn().mockReturnValue(1),
    dequeue: vi.fn().mockReturnValue(null),
    size: vi.fn().mockReturnValue(0),
    clear: vi.fn().mockReturnValue(0),
  };
  const chat = vi.fn();
  for (const completion of input.completions ?? [
    {
      provider: "openai" as const,
      model: "gpt-test",
      message: {
        role: "assistant" as const,
        content: "已处理",
        toolCalls: [],
      },
      usage: {
        totalTokens: input.contextCompactionTotalTokenThreshold + 1,
      },
    },
  ]) {
    chat.mockResolvedValueOnce(completion);
  }
  const llmClient: LlmClient = {
    chat,
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn().mockResolvedValue([]),
  };

  return {
    runtime: new RootLoopAgent({
      llmClient,
      context: input.context,
      eventQueue,
      session,
      tools: new ToolCatalog([new WaitTool()]).pick(["wait"]),
      contextSummaryOperation: input.contextSummaryOperation,
      contextCompactionTotalTokenThreshold: input.contextCompactionTotalTokenThreshold,
      llmRetryBackoffMs: input.llmRetryBackoffMs,
      sleep: input.sleep,
    }),
    chat,
  };
}

function createInMemorySnapshotRepository(): RootAgentRuntimeSnapshotRepository & {
  snapshot: PersistedRootAgentRuntimeSnapshot | null;
} {
  let snapshot: PersistedRootAgentRuntimeSnapshot | null = null;

  return {
    get snapshot() {
      return snapshot ? structuredClone(snapshot) : null;
    },
    load: vi.fn(async () => {
      return snapshot ? structuredClone(snapshot) : null;
    }),
    save: vi.fn(async nextSnapshot => {
      snapshot = structuredClone(nextSnapshot);
    }),
    delete: vi.fn(async () => {
      snapshot = null;
    }),
  };
}

describe("RootLoopAgent", () => {
  it("should keep tool definitions stable and inject state-specific reminder per round", async () => {
    const stopError = new StopLoopError("stop-loop");
    const getRecentGroupMessages = vi
      .fn()
      .mockResolvedValue([createGroupHistoryMessage("history message")]);
    const sleep = vi.fn().mockRejectedValue(stopError);
    const waitNow = new Date("2026-03-30T12:00:00.000Z");
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn().mockImplementation(async ({ groupId }) => ({
          groupId,
          groupName: groupId === "group-1" ? "产品群" : "测试群",
          memberCount: 123,
          maxMemberCount: 500,
          groupRemark: "",
          groupAllShut: false,
        })),
        getRecentGroupMessages,
      },
      listenGroupIds: ["group-1", "group-2"],
      recentMessageLimit: 2,
    });

    const invokeExecute = vi.fn().mockResolvedValue({
      content: JSON.stringify({ ok: true, message: "noop" }),
      signal: "continue",
    });
    const searchWebExecute = vi.fn().mockResolvedValue({
      content: "search summary",
      signal: "continue",
    });
    const toolCatalog = new ToolCatalog([
      new EnterTool(),
      new BackToPortalTool(),
      new WaitTool({
        now: () => waitNow,
      }),
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
      } satisfies ToolComponent,
      {
        name: "invoke",
        description: "invoke",
        parameters: { type: "object", properties: {} },
        kind: "business",
        llmTool: {
          name: "invoke",
          description: "invoke",
          parameters: { type: "object", properties: {} },
        },
        execute: invokeExecute,
      } satisfies ToolComponent,
    ]);

    const llmClient: LlmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "enter-1",
                name: "enter",
                arguments: { kind: "qq_group", id: "group-1" },
              },
            ],
          },
        })
        .mockResolvedValueOnce({
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "back-1", name: "back_to_portal", arguments: {} }],
          },
        })
        .mockResolvedValueOnce({
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "wait-1", name: "wait", arguments: {} }],
          },
        }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const dequeuedEvents = [createGroupEvent("hello portal"), null, null, null];
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      dequeue: vi.fn(() => dequeuedEvents.shift() ?? null),
      size: vi.fn(() => dequeuedEvents.filter(event => event !== null).length),
      clear: vi.fn(() => {
        const remaining = dequeuedEvents.filter(event => event !== null).length;
        dequeuedEvents.splice(0, dequeuedEvents.length);
        return remaining;
      }),
    };
    const runtime = new RootLoopAgent({
      llmClient,
      context,
      eventQueue,
      session,
      tools: toolCatalog.pick(["enter", "back_to_portal", "invoke", "wait", "search_web"]),
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    const chatCalls = vi.mocked(llmClient.chat).mock.calls;
    expect(chatCalls).toHaveLength(3);
    expect(chatCalls[0]?.[0].tools.map(tool => tool.name)).toEqual([
      "enter",
      "back_to_portal",
      "invoke",
      "wait",
      "search_web",
    ]);
    expect(chatCalls[1]?.[0].tools.map(tool => tool.name)).toEqual([
      "enter",
      "back_to_portal",
      "invoke",
      "wait",
      "search_web",
    ]);
    expect(chatCalls[2]?.[0].tools.map(tool => tool.name)).toEqual([
      "enter",
      "back_to_portal",
      "invoke",
      "wait",
      "search_web",
    ]);
    expect(getRecentGroupMessages).toHaveBeenCalledWith({
      groupId: "group-1",
      count: 2,
    });
    expect(invokeExecute).not.toHaveBeenCalled();
    expect(searchWebExecute).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(10);

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你当前处于门户状态"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("QQ 群 产品群（group-1），未读 0 条"),
      ),
    ).toBe(true);
    const enterAssistantIndex = snapshot.messages.findIndex(
      message =>
        message.role === "assistant" &&
        message.toolCalls.some(toolCall => toolCall.id === "enter-1" && toolCall.name === "enter"),
    );
    const enterToolResultIndex = snapshot.messages.findIndex(
      message => message.role === "tool" && message.toolCallId === "enter-1",
    );
    const historyMessageIndex = snapshot.messages.findIndex(
      message =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes("history message"),
    );

    expect(enterAssistantIndex).toBeGreaterThanOrEqual(0);
    expect(enterToolResultIndex).toBeGreaterThan(enterAssistantIndex);
    expect(historyMessageIndex).toBeGreaterThan(enterToolResultIndex);

    const dashboardSnapshot = await runtime.getDashboardSnapshot();
    expect(dashboardSnapshot.initialized).toBe(true);
    expect(dashboardSnapshot.lastLlmCall).toMatchObject({
      provider: "openai",
      model: "gpt-test",
    });
    expect(dashboardSnapshot.lastToolCall).toMatchObject({
      name: "wait",
    });
    expect(dashboardSnapshot.lastToolResultPreview).toBe("休息结束了");
    expect(dashboardSnapshot.loopState).toBe("crashed");
  });

  it("should expose post-tool context to nested search without persisting unfinished wait tool call", async () => {
    const stopError = new StopLoopError("stop-loop");
    const sleep = vi.fn().mockRejectedValue(stopError);
    const waitNow = new Date("2026-03-30T12:00:00.000Z");
    const webSearchAgent = {
      search: vi.fn().mockResolvedValue("search summary"),
    };
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn().mockResolvedValue({
          groupId: "group-1",
          groupName: "产品群",
          memberCount: 123,
          maxMemberCount: 500,
          groupRemark: "",
          groupAllShut: false,
        }),
        getRecentGroupMessages: vi
          .fn()
          .mockResolvedValue([createGroupHistoryMessage("history message")]),
      },
      listenGroupIds: ["group-1"],
      recentMessageLimit: 1,
    });
    const llmClient: LlmClient = {
      chat: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "enter-1", name: "enter", arguments: { kind: "qq_group", id: "group-1" } },
            {
              id: "search-1",
              name: "search_web",
              arguments: { question: "今天有什么热点" },
            },
            { id: "back-1", name: "back_to_portal", arguments: {} },
            { id: "wait-1", name: "wait", arguments: {} },
          ],
        },
      }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      dequeue: vi.fn().mockReturnValue(null),
      size: vi.fn().mockReturnValue(0),
      clear: vi.fn().mockReturnValue(0),
    };
    const runtime = new RootLoopAgent({
      llmClient,
      context,
      eventQueue,
      session,
      tools: new ToolCatalog([
        new EnterTool(),
        new SearchWebTool({ webSearchAgent }),
        new BackToPortalTool(),
        new WaitTool({
          now: () => waitNow,
        }),
      ]).pick(["enter", "search_web", "back_to_portal", "wait"]),
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    expect(webSearchAgent.search).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "今天有什么热点",
        systemPrompt: "system-prompt",
        contextMessages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("你当前处于门户状态"),
          }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("history message"),
          }),
        ]),
      }),
    );
    const searchContext = vi.mocked(webSearchAgent.search).mock.calls[0]?.[0].contextMessages ?? [];
    expect(searchContext.some((message: { role: string }) => message.role === "assistant")).toBe(
      false,
    );
    expect(searchContext.some((message: { role: string }) => message.role === "tool")).toBe(false);

    const snapshot = await context.getSnapshot();
    const assistantIndex = snapshot.messages.findIndex(
      message =>
        message.role === "assistant" &&
        message.toolCalls.some(toolCall => toolCall.id === "enter-1") &&
        message.toolCalls.some(toolCall => toolCall.id === "search-1"),
    );
    const enterToolResultIndex = snapshot.messages.findIndex(
      message => message.role === "tool" && message.toolCallId === "enter-1",
    );
    const historyMessageIndex = snapshot.messages.findIndex(
      message =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes("history message"),
    );
    const searchToolResultIndex = snapshot.messages.findIndex(
      message => message.role === "tool" && message.toolCallId === "search-1",
    );
    const waitAssistantIndex = snapshot.messages.findIndex(
      message =>
        message.role === "assistant" &&
        message.toolCalls.some(toolCall => toolCall.id === "wait-1" && toolCall.name === "wait"),
    );
    const waitToolResultIndex = snapshot.messages.findIndex(
      message => message.role === "tool" && message.toolCallId === "wait-1",
    );
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(enterToolResultIndex).toBeGreaterThan(assistantIndex);
    expect(historyMessageIndex).toBeGreaterThan(enterToolResultIndex);
    expect(searchToolResultIndex).toBeGreaterThan(historyMessageIndex);
    expect(waitAssistantIndex).toBeGreaterThanOrEqual(0);
    expect(waitToolResultIndex).toBeGreaterThan(waitAssistantIndex);
  });

  it("should retry recoverable llm failures after the configured backoff", async () => {
    initTestLoggerRuntime();
    const stopError = new StopLoopError("stop-loop");
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      if (ms === 30_000) {
        return;
      }

      throw stopError;
    });
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn().mockResolvedValue({
          groupId: "group-1",
          groupName: "产品群",
          memberCount: 123,
          maxMemberCount: 500,
          groupRemark: "",
          groupAllShut: false,
        }),
        getRecentGroupMessages: vi.fn().mockResolvedValue([]),
      },
      listenGroupIds: ["group-1"],
      recentMessageLimit: 0,
    });
    const llmClient: LlmClient = {
      chat: vi
        .fn()
        .mockRejectedValueOnce(
          new BizError({
            message: "所选 LLM provider 当前不可用",
          }),
        )
        .mockResolvedValueOnce({
          provider: "openai-codex",
          model: "gpt-5.4",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "wait-1", name: "wait", arguments: {} }],
          },
        }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      dequeue: vi.fn().mockReturnValue(null),
      size: vi.fn().mockReturnValue(0),
      clear: vi.fn().mockReturnValue(0),
    };
    const runtime = new RootLoopAgent({
      llmClient,
      context,
      eventQueue,
      session,
      tools: new ToolCatalog([new WaitTool()]).pick(["wait"]),
      sleep,
      llmRetryBackoffMs: 30_000,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    expect(llmClient.chat).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 30_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 10);
  });

  it("does not compact existing context during initialize", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    await context.appendMessages([
      createUserMessage("alpha"),
      createUserMessage("beta"),
      createUserMessage("gamma"),
    ]);
    const summarize = vi.fn().mockResolvedValue("累计摘要");
    const { runtime } = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionTotalTokenThreshold: 2,
    });

    await runtime.initialize();

    expect(summarize).not.toHaveBeenCalled();
  });

  it("should retry recoverable context summary failures after the configured backoff", async () => {
    initTestLoggerRuntime();
    const stopError = new StopLoopError("stop-loop");
    const sleep = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(stopError);
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    await context.appendMessages([
      createUserMessage("alpha"),
      createUserMessage("beta"),
      createUserMessage("gamma"),
    ]);
    const summarize = vi
      .fn()
      .mockRejectedValueOnce(
        new BizError({
          message: "LLM 上游服务调用失败",
        }),
      )
      .mockResolvedValueOnce("累计摘要");
    const { runtime } = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionTotalTokenThreshold: 2,
      llmRetryBackoffMs: 30_000,
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    expect(summarize).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 30_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 10);
    const snapshot = await context.getSnapshot();
    expect(snapshot.messages[0]).toEqual(createConversationSummaryMessage("累计摘要"));
    expect(snapshot.messages[1]).toMatchObject({
      role: "assistant",
      content: "已处理",
    });
  });

  it("should return a temporary failure tool result to the agent when tool execution throws", async () => {
    initTestLoggerRuntime();
    const stopError = new StopLoopError("stop-loop");
    const sleep = vi.fn().mockRejectedValue(stopError);
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn().mockResolvedValue({
          groupId: "group-1",
          groupName: "产品群",
          memberCount: 123,
          maxMemberCount: 500,
          groupRemark: "",
          groupAllShut: false,
        }),
        getRecentGroupMessages: vi.fn().mockResolvedValue([]),
      },
      listenGroupIds: ["group-1"],
      recentMessageLimit: 0,
    });
    const llmClient: LlmClient = {
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "explode-1", name: "explode", arguments: {} }],
          },
        })
        .mockResolvedValueOnce({
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "wait-1", name: "wait", arguments: {} }],
          },
        }),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const runtime = new RootLoopAgent({
      llmClient,
      context,
      eventQueue: {
        enqueue: vi.fn().mockReturnValue(1),
        dequeue: vi.fn().mockReturnValue(null),
        size: vi.fn().mockReturnValue(0),
        clear: vi.fn().mockReturnValue(0),
      },
      session,
      tools: new ToolCatalog([
        {
          name: "explode",
          description: "explode",
          parameters: { type: "object", properties: {} },
          kind: "business",
          llmTool: {
            name: "explode",
            description: "explode",
            parameters: { type: "object", properties: {} },
          },
          execute: vi.fn().mockRejectedValue(new Error("service unavailable")),
        } satisfies ToolComponent,
        new WaitTool(),
      ]).pick(["explode", "wait"]),
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    const snapshot = await context.getSnapshot();
    const toolFailureMessage = snapshot.messages.find(
      message => message.role === "tool" && message.toolCallId === "explode-1",
    );

    expect(toolFailureMessage).toBeDefined();
    expect(toolFailureMessage?.content).toContain("TEMPORARY_TOOL_FAILURE");
    expect(toolFailureMessage?.content).toContain("工具 explode 暂时调用失败了");
  });

  it("should summarize older context messages after commit when totalTokens exceeds the threshold", async () => {
    const stopError = new StopLoopError("stop-loop");
    const sleep = vi.fn().mockRejectedValue(stopError);
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    await context.appendMessages([
      createUserMessage("alpha"),
      createUserMessage("beta"),
      createUserMessage("gamma"),
    ]);
    const summarize = vi.fn().mockResolvedValue("累计摘要");
    const { runtime } = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionTotalTokenThreshold: 2,
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    expect(summarize).toHaveBeenCalledTimes(1);
    const summarizeInput = summarize.mock.calls[0]?.[0];
    expect(summarizeInput?.tools).toEqual([]);
    expect(summarizeInput?.messages.slice(0, 3)).toEqual([
      createUserMessage("alpha"),
      createUserMessage("beta"),
      createUserMessage("gamma"),
    ]);
    expect(summarizeInput?.messages[3]).toMatchObject({
      role: "user",
      content: expect.stringContaining("你当前处于门户状态"),
    });

    const snapshot = await context.getSnapshot();
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[0]).toEqual(createConversationSummaryMessage("累计摘要"));
    expect(snapshot.messages[1]).toMatchObject({
      role: "assistant",
      content: "已处理",
    });

    const dashboardSnapshot = await runtime.getDashboardSnapshot();
    expect(dashboardSnapshot.lastCompactionAt).not.toBeNull();
    expect(dashboardSnapshot.contextSummary.messageCount).toBe(2);
  });

  it("does not summarize after commit when totalTokens does not exceed the threshold", async () => {
    const stopError = new StopLoopError("stop-loop");
    const sleep = vi.fn().mockRejectedValue(stopError);
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const summarize = vi.fn().mockResolvedValue("累计摘要");
    const { runtime } = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionTotalTokenThreshold: 100,
      completions: [
        {
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "已处理",
            toolCalls: [],
          },
          usage: {
            totalTokens: 100,
          },
        },
      ],
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    expect(summarize).not.toHaveBeenCalled();
    expect((await runtime.getDashboardSnapshot()).lastCompactionAt).toBeNull();
  });

  it("skips summary after commit when totalTokens is missing", async () => {
    const stopError = new StopLoopError("stop-loop");
    const sleep = vi.fn().mockRejectedValue(stopError);
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const summarize = vi.fn().mockResolvedValue("累计摘要");
    const { runtime } = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionTotalTokenThreshold: 2,
      completions: [
        {
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "已处理",
            toolCalls: [],
          },
        },
      ],
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    expect(summarize).not.toHaveBeenCalled();
    expect((await runtime.getDashboardSnapshot()).lastCompactionAt).toBeNull();
  });

  it("should persist and restore runtime snapshot without duplicating wake reminder", async () => {
    const repository = createInMemorySnapshotRepository();
    const stopError = new StopLoopError("stop-loop");
    const firstNow = new Date("2026-03-30T12:00:00.000Z");
    const secondNow = new Date("2026-03-30T12:00:30.000Z");
    const createSession = (context: DefaultAgentContext) =>
      new RootAgentSession({
        context,
        napcatGatewayService: {
          start: vi.fn(),
          stop: vi.fn(),
          sendGroupMessage: vi.fn(),
          getGroupInfo: vi.fn().mockResolvedValue({
            groupId: "group-1",
            groupName: "产品群",
            memberCount: 123,
            maxMemberCount: 500,
            groupRemark: "",
            groupAllShut: false,
          }),
          getRecentGroupMessages: vi.fn().mockResolvedValue([]),
        },
        listenGroupIds: ["group-1"],
        recentMessageLimit: 0,
      });

    const firstContext = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    const firstRuntime = new RootLoopAgent({
      llmClient: {
        chat: vi.fn().mockResolvedValue({
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "wait-1", name: "wait", arguments: {} }],
          },
        }),
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn().mockResolvedValue([]),
      },
      context: firstContext,
      eventQueue: {
        enqueue: vi.fn().mockReturnValue(1),
        dequeue: vi.fn().mockReturnValue(null),
        size: vi.fn().mockReturnValue(0),
        clear: vi.fn().mockReturnValue(0),
      },
      session: createSession(firstContext),
      snapshotRepository: repository,
      tools: new ToolCatalog([
        new WaitTool({
          now: () => firstNow,
        }),
      ]).pick(["wait"]),
      now: () => firstNow,
      sleep: vi.fn().mockRejectedValue(stopError),
    });

    await expect(firstRuntime.run()).rejects.toBe(stopError);
    expect(repository.snapshot).not.toBeNull();

    const restoredContext = new DefaultAgentContext({
      systemPromptFactory: () => "another-system-prompt",
    });
    const restoredRuntime = new RootLoopAgent({
      llmClient: {
        chat: vi.fn().mockResolvedValue({
          provider: "openai",
          model: "gpt-test",
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "wait-2", name: "wait", arguments: {} }],
          },
        }),
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn().mockResolvedValue([]),
      },
      context: restoredContext,
      eventQueue: {
        enqueue: vi.fn().mockReturnValue(1),
        dequeue: vi.fn().mockReturnValue(null),
        size: vi.fn().mockReturnValue(0),
        clear: vi.fn().mockReturnValue(0),
      },
      session: createSession(restoredContext),
      snapshotRepository: repository,
      tools: new ToolCatalog([
        new WaitTool({
          now: () => secondNow,
        }),
      ]).pick(["wait"]),
      now: () => secondNow,
      sleep: vi.fn().mockRejectedValue(stopError),
    });

    await restoredRuntime.restorePersistedSnapshot(repository.snapshot!);
    await expect(restoredRuntime.run()).rejects.toBe(stopError);

    const restoredSnapshot = await restoredContext.getSnapshot();
    const wakeReminderCount = restoredSnapshot.messages.filter(
      message =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes("当前时间为北京时间"),
    ).length;

    expect(restoredSnapshot.systemPrompt).toBe("another-system-prompt");
    expect(wakeReminderCount).toBe(1);
  });

  it("should reset runtime context, session and pending queue into a clean persisted snapshot", async () => {
    const repository = createInMemorySnapshotRepository();
    const eventQueue = new InMemoryAgentEventQueue();
    eventQueue.enqueue(createGroupEvent("queued-before-reset"));
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "latest-system-prompt",
    });
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn().mockResolvedValue({
          groupId: "group-1",
          groupName: "产品群",
          memberCount: 123,
          maxMemberCount: 500,
          groupRemark: "",
          groupAllShut: false,
        }),
        getRecentGroupMessages: vi.fn().mockResolvedValue([]),
      },
      listenGroupIds: ["group-1"],
      recentMessageLimit: 0,
    });
    const runtime = new RootLoopAgent({
      llmClient: {
        chat: vi.fn(),
        chatDirect: vi.fn(),
        listAvailableProviders: vi.fn().mockResolvedValue([]),
      },
      context,
      eventQueue,
      session,
      snapshotRepository: repository,
      tools: new ToolCatalog([new WaitTool()]).pick(["wait"]),
    });

    await runtime.initialize();
    await context.appendMessages([createUserMessage("old-context-message")]);
    await session.wait({
      deadlineAt: new Date("2026-03-30T12:05:00.000Z"),
    });

    const result = await runtime.resetContext();
    const snapshot = await context.getSnapshot();

    expect(result.resetAt).toBeInstanceOf(Date);
    expect(session.getState()).toEqual({
      kind: "portal",
    });
    expect(eventQueue.size()).toBe(0);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("old-context-message"),
      ),
    ).toBe(false);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你当前处于门户状态"),
      ),
    ).toBe(true);
    expect(repository.snapshot).toMatchObject({
      runtimeKey: "root-agent",
      sessionSnapshot: {
        state: {
          kind: "portal",
        },
      },
      lastWakeReminderAt: null,
    });
    expect(repository.snapshot?.contextSnapshot).toEqual({
      messages: snapshot.messages,
    });
  });

  it("should wait for the active round to finish before resetting context", async () => {
    const stopError = new StopLoopError("stop-loop");
    const chatDeferred = createDeferred<Awaited<ReturnType<LlmClient["chat"]>>>();
    const sleep = vi.fn().mockRejectedValue(stopError);
    const eventQueue = new InMemoryAgentEventQueue();
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "latest-system-prompt",
    });
    const session = new RootAgentSession({
      context,
      napcatGatewayService: {
        start: vi.fn(),
        stop: vi.fn(),
        sendGroupMessage: vi.fn(),
        getGroupInfo: vi.fn().mockResolvedValue({
          groupId: "group-1",
          groupName: "产品群",
          memberCount: 123,
          maxMemberCount: 500,
          groupRemark: "",
          groupAllShut: false,
        }),
        getRecentGroupMessages: vi.fn().mockResolvedValue([]),
      },
      listenGroupIds: ["group-1"],
      recentMessageLimit: 0,
    });
    const llmClient: LlmClient = {
      chat: vi.fn().mockReturnValue(chatDeferred.promise),
      chatDirect: vi.fn(),
      listAvailableProviders: vi.fn().mockResolvedValue([]),
    };
    const runtime = new RootLoopAgent({
      llmClient,
      context,
      eventQueue,
      session,
      snapshotRepository: createInMemorySnapshotRepository(),
      tools: new ToolCatalog([new WaitTool()]).pick(["wait"]),
      sleep,
    });

    const runPromise = runtime.run();
    await vi.waitFor(() => {
      expect(llmClient.chat).toHaveBeenCalledTimes(1);
    });

    let resetResolved = false;
    const resetPromise = runtime.resetContext().then(result => {
      resetResolved = true;
      return result;
    });

    await Promise.resolve();
    expect(resetResolved).toBe(false);

    chatDeferred.resolve({
      provider: "openai",
      model: "gpt-test",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "wait-1", name: "wait", arguments: {} }],
      },
    });

    await expect(resetPromise).resolves.toMatchObject({
      resetAt: expect.any(Date),
    });
    await expect(runPromise).rejects.toBe(stopError);

    const snapshot = await context.getSnapshot();
    expect(
      snapshot.messages.some(message => message.role === "tool" && message.toolCallId === "wait-1"),
    ).toBe(false);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你当前处于门户状态"),
      ),
    ).toBe(true);
  });
});
