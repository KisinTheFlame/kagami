import { describe, expect, it, vi } from "vitest";
import { ToolCatalog, type ToolComponent } from "@kagami/agent-runtime";
import { SearchWebTool } from "../../src/agent/capabilities/web-search/tools/search-web.tool.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import {
  createConversationSummaryMessage,
  createUserMessage,
} from "../../src/agent/runtime/context/context-message-factory.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import { RootAgentRuntime } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { BackToPortalTool } from "../../src/agent/runtime/root-agent/tools/back-to-portal.tool.js";
import { EnterTool } from "../../src/agent/runtime/root-agent/tools/enter.tool.js";
import { WaitTool } from "../../src/agent/runtime/root-agent/tools/wait.tool.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmMessage, Tool } from "../../src/llm/types.js";

class StopLoopError extends Error {}

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
  contextCompactionThreshold: number;
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
  };
  const llmClient: LlmClient = {
    chat: vi.fn(),
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn().mockResolvedValue([]),
  };

  return new RootAgentRuntime({
    llmClient,
    context: input.context,
    eventQueue,
    session,
    tools: new ToolCatalog([new WaitTool()]).pick(["wait"]),
    contextSummaryOperation: input.contextSummaryOperation,
    contextCompactionThreshold: input.contextCompactionThreshold,
  });
}

describe("RootAgentRuntime", () => {
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
    };
    const runtime = new RootAgentRuntime({
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
    expect(dashboardSnapshot.lastToolResultPreview).toContain("deadlineAt");
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
    };
    const runtime = new RootAgentRuntime({
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

  it("should summarize the full context and replace it with a single cumulative summary", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    await context.appendMessages([
      createUserMessage("alpha"),
      createUserMessage("beta"),
      createUserMessage("gamma"),
    ]);
    const summarize = vi.fn().mockResolvedValue("累计摘要");
    const runtime = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionThreshold: 2,
    });

    await runtime.initialize();

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize).toHaveBeenCalledWith({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "alpha" }),
        expect.objectContaining({ role: "user", content: "beta" }),
        expect.objectContaining({ role: "user", content: "gamma" }),
      ]),
      tools: [],
    });

    const snapshot = await context.getSnapshot();
    expect(snapshot.messages).toEqual([createConversationSummaryMessage("累计摘要")]);

    const dashboardSnapshot = await runtime.getDashboardSnapshot();
    expect(dashboardSnapshot.lastCompactionAt).not.toBeNull();
    expect(dashboardSnapshot.contextSummary.messageCount).toBe(1);
  });
});
