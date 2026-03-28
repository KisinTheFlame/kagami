import { describe, expect, it, vi } from "vitest";
import { ToolCatalog, type ToolComponent } from "@kagami/agent-runtime";
import { RootAgentRuntime } from "../../src/agent/runtime/root-agent/root-agent-runtime.js";
import { RootAgentSession } from "../../src/agent/runtime/root-agent/session/root-agent-session.js";
import { EnterGroupTool } from "../../src/agent/runtime/root-agent/tools/enter-group.tool.js";
import { ExitGroupTool } from "../../src/agent/runtime/root-agent/tools/exit-group.tool.js";
import { SleepTool } from "../../src/agent/runtime/root-agent/tools/sleep.tool.js";
import { DefaultAgentContext } from "../../src/agent/runtime/context/default-agent-context.js";
import type { AgentEventQueue } from "../../src/agent/runtime/event/event.queue.js";
import type { LlmClient } from "../../src/llm/client.js";

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

describe("RootAgentRuntime", () => {
  it("should start in portal tools, switch to group tools, then return to portal and sleep", async () => {
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
        getGroupInfo: vi.fn(),
        getRecentGroupMessages,
      },
      listenGroupIds: ["group-1", "group-2"],
      recentMessageLimit: 2,
    });

    const sendMessageExecute = vi.fn().mockResolvedValue({
      content: JSON.stringify({ ok: true, messageId: 9527 }),
      signal: "continue",
    });
    const toolCatalog = new ToolCatalog([
      new EnterGroupTool(),
      new ExitGroupTool(),
      new SleepTool({
        sleepMs: 30_000,
      }),
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
            toolCalls: [{ id: "exit-1", name: "exit_group", arguments: {} }],
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
      portalTools: toolCatalog.pick(["enter_group", "sleep"]),
      groupTools: toolCatalog.pick(["send_message", "exit_group"]),
      sleep,
    });

    await expect(runtime.run()).rejects.toBe(stopError);

    const chatCalls = vi.mocked(llmClient.chat).mock.calls;
    expect(chatCalls).toHaveLength(3);
    expect(chatCalls[0]?.[0].tools.map(tool => tool.name)).toEqual(["enter_group", "sleep"]);
    expect(chatCalls[1]?.[0].tools.map(tool => tool.name)).toEqual(["send_message", "exit_group"]);
    expect(chatCalls[2]?.[0].tools.map(tool => tool.name)).toEqual(["enter_group", "sleep"]);
    expect(getRecentGroupMessages).toHaveBeenCalledWith({
      groupId: "group-1",
      count: 2,
    });
    expect(sendMessageExecute).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(30_000);

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
          typeof message.content === "string" && message.content.includes("你已进入群 group-1"),
      ),
    ).toBe(true);
    expect(
      snapshot.messages.some(
        message =>
          typeof message.content === "string" && message.content.includes("你已退出群 group-1"),
      ),
    ).toBe(true);

    const enterAssistantIndex = snapshot.messages.findIndex(
      message =>
        message.role === "assistant" &&
        message.toolCalls.some(toolCall => toolCall.id === "enter-1" && toolCall.name === "enter_group"),
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
});
