import { describe, expect, it, vi } from "vitest";
import { ToolCatalog, type ToolComponent } from "@kagami/agent-runtime";
import { SearchWebTool } from "../../src/agent/capabilities/web-search/tools/search-web.tool.js";
import { RootAgentRuntime } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { BackToPortalTool } from "../../src/agent/runtime/root-agent/tools/back-to-portal.tool.js";
import { EnterGroupTool } from "../../src/agent/runtime/root-agent/tools/enter-group.tool.js";
import { SleepTool } from "../../src/agent/runtime/root-agent/tools/sleep.tool.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import {
  createConversationSummaryMessage,
  createUserMessage,
} from "../../src/agent/runtime/context/context-message-factory.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
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
    tools: new ToolCatalog([new SleepTool({ sleepMs: 1 })]).pick(["sleep"]),
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

    const sendMessageExecute = vi.fn().mockResolvedValue({
      content: JSON.stringify({ ok: true, messageId: 9527 }),
      signal: "continue",
    });
    const searchWebExecute = vi.fn().mockResolvedValue({
      content: "search summary",
      signal: "continue",
    });
    const toolCatalog = new ToolCatalog([
      new EnterGroupTool(),
      new BackToPortalTool(),
      new SleepTool({
        sleepMs: 30_000,
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
            toolCalls: [{ id: "enter-1", name: "enter_group", arguments: { groupId: "group-1" } }],
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
            toolCalls: [{ id: "sleep-1", name: "sleep", arguments: {} }],
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
      tools: toolCatalog.pick([
        "enter_group",
        "back_to_portal",
        "send_message",
        "sleep",
        "search_web",
      ]),
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    const chatCalls = vi.mocked(llmClient.chat).mock.calls;
    expect(chatCalls).toHaveLength(3);
    expect(chatCalls[0]?.[0].tools.map(tool => tool.name)).toEqual([
      "enter_group",
      "back_to_portal",
      "send_message",
      "sleep",
      "search_web",
    ]);
    expect(chatCalls[1]?.[0].tools.map(tool => tool.name)).toEqual([
      "enter_group",
      "back_to_portal",
      "send_message",
      "sleep",
      "search_web",
    ]);
    expect(chatCalls[2]?.[0].tools.map(tool => tool.name)).toEqual([
      "enter_group",
      "back_to_portal",
      "send_message",
      "sleep",
      "search_web",
    ]);
    expect(getRecentGroupMessages).toHaveBeenCalledWith({
      groupId: "group-1",
      count: 2,
    });
    expect(sendMessageExecute).not.toHaveBeenCalled();
    expect(searchWebExecute).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(30_000);

    const firstReminder = chatCalls[0]?.[0].messages.at(-1);
    const secondReminder = chatCalls[1]?.[0].messages.at(-1);
    expect(firstReminder).toEqual(
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("当前允许动作：enter_group、sleep"),
      }),
    );
    expect(secondReminder).toEqual(
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("当前允许动作：send_message、back_to_portal、search_web"),
      }),
    );

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
          message.content.includes("群 产品群（group-1），未读 0 条"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("群 测试群（group-2），尚未查看，可进入看看最近消息"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你已进入群 group-1"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你已退出群 group-1"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("当前允许动作：enter_group、sleep"),
      ),
    ).toBe(false);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" &&
          message.content.includes("当前允许动作：send_message、back_to_portal、search_web"),
      ),
    ).toBe(false);

    const enterAssistantIndex = snapshot.messages.findIndex(
      message =>
        message.role === "assistant" &&
        message.toolCalls.some(
          toolCall => toolCall.id === "enter-1" && toolCall.name === "enter_group",
        ),
    );
    const enterToolResultIndex = snapshot.messages.findIndex(
      message => message.role === "tool" && message.toolCallId === "enter-1",
    );
    const enterGroupNoticeIndex = snapshot.messages.findIndex(
      message =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes("你已进入群 group-1"),
    );
    const historyMessageIndex = snapshot.messages.findIndex(
      message =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes("history message"),
    );

    expect(enterAssistantIndex).toBeGreaterThanOrEqual(0);
    expect(enterToolResultIndex).toBeGreaterThan(enterAssistantIndex);
    expect(enterGroupNoticeIndex).toBeGreaterThan(enterToolResultIndex);
    expect(historyMessageIndex).toBeGreaterThan(enterToolResultIndex);
  });

  it("should expose post-tool context to nested search without persisting an unfinished tool call", async () => {
    const stopError = new StopLoopError("stop-loop");
    const sleep = vi.fn().mockRejectedValue(stopError);
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
            { id: "enter-1", name: "enter_group", arguments: { groupId: "group-1" } },
            {
              id: "search-1",
              name: "search_web",
              arguments: { question: "今天有什么热点" },
            },
            { id: "back-1", name: "back_to_portal", arguments: {} },
            { id: "sleep-1", name: "sleep", arguments: {} },
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
        new EnterGroupTool(),
        new SearchWebTool({ webSearchAgent }),
        new BackToPortalTool(),
        new SleepTool({ sleepMs: 30_000 }),
      ]).pick(["enter_group", "search_web", "back_to_portal", "sleep"]),
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
            content: expect.stringContaining("你已进入群 group-1"),
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
    const enterGroupNoticeIndex = snapshot.messages.findIndex(
      message =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.includes("你已进入群 group-1"),
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

    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(enterToolResultIndex).toBeGreaterThan(assistantIndex);
    expect(enterGroupNoticeIndex).toBeGreaterThan(enterToolResultIndex);
    expect(historyMessageIndex).toBeGreaterThan(enterGroupNoticeIndex);
    expect(searchToolResultIndex).toBeGreaterThan(historyMessageIndex);
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
  });

  it("should re-summarize existing conversation summary together with newer messages", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    await context.appendMessages([
      createConversationSummaryMessage("旧上下文摘要"),
      createUserMessage("新增消息"),
      createUserMessage("再新增一条"),
    ]);
    const summarize = vi.fn().mockResolvedValue("新的累计摘要");
    const runtime = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionThreshold: 2,
    });

    await runtime.initialize();

    expect(summarize).toHaveBeenCalledWith({
      messages: [
        createConversationSummaryMessage("旧上下文摘要"),
        createUserMessage("新增消息"),
        createUserMessage("再新增一条"),
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("你当前处于门户状态"),
        }),
      ],
      tools: [],
    });

    const snapshot = await context.getSnapshot();
    expect(snapshot.messages).toEqual([createConversationSummaryMessage("新的累计摘要")]);
  });

  it("should keep original messages when summary returns null", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    await context.appendMessages([
      createUserMessage("alpha"),
      createUserMessage("beta"),
      createUserMessage("gamma"),
    ]);
    const summarize = vi.fn().mockResolvedValue(null);
    const runtime = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionThreshold: 2,
    });

    await runtime.initialize();

    const snapshot = await context.getSnapshot();
    expect(snapshot.messages).toEqual([
      createUserMessage("alpha"),
      createUserMessage("beta"),
      createUserMessage("gamma"),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("你当前处于门户状态"),
      }),
    ]);
  });

  it("should not summarize when message count does not exceed threshold", async () => {
    const context = new DefaultAgentContext({
      systemPromptFactory: () => "system-prompt",
    });
    await context.appendMessages([createUserMessage("alpha")]);
    const summarize = vi.fn().mockResolvedValue("不会被使用");
    const runtime = createRuntimeForCompactionTest({
      context,
      contextSummaryOperation: { summarize },
      contextCompactionThreshold: 2,
    });

    await runtime.initialize();

    expect(summarize).not.toHaveBeenCalled();

    const snapshot = await context.getSnapshot();
    expect(snapshot.messages).toEqual([
      createUserMessage("alpha"),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("你当前处于门户状态"),
      }),
    ]);
  });
});
