import { describe, expect, it, vi } from "vitest";
import { AgentLoop } from "../../src/agent/agent-loop.js";
import type { AgentContextManager } from "../../src/agent/context-manager.manager.js";
import type { AgentEventQueue } from "../../src/agent/event-queue.queue.js";
import type { AgentToolRegistry } from "../../src/agent/tools/index.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload } from "../../src/llm/types.js";

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

describe("AgentLoop", () => {
  it("should consume queue events and execute one enabled tool round", async () => {
    const stopError = new StopLoopError("stop-loop");
    const finishExecute = vi.fn().mockResolvedValue({
      content: JSON.stringify({ finished: true }),
      shouldFinishRound: true,
    });
    const disabledExecute = vi.fn();
    const sendGroupMessageExecute = vi.fn();
    const toolRegistry: AgentToolRegistry = {
      finish: {
        tool: {
          name: "finish",
          description: "finish",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        execute: finishExecute,
      },
      search_web: {
        tool: {
          name: "search_web",
          description: "search",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        execute: disabledExecute,
      },
      send_group_message: {
        tool: {
          name: "send_group_message",
          description: "send",
          parameters: {
            type: "object",
            properties: {},
          },
        },
        execute: sendGroupMessageExecute,
      },
    };

    const chat = vi.fn().mockResolvedValue(createLlmResponse());
    const llmClient: LlmClient = {
      chat,
      listAvailableProviders: vi.fn().mockReturnValue([]),
    };

    const getSystemPrompt = vi.fn().mockReturnValue("system-prompt");
    const getMessages = vi.fn().mockReturnValue([]);
    const getSteps = vi.fn().mockReturnValue(0);
    const pushUserMessage = vi.fn();
    const pushAssistantMessage = vi.fn().mockReturnValue("done");
    const pushToolMessage = vi.fn();
    const contextManager: AgentContextManager = {
      getSystemPrompt,
      getMessages,
      getSteps,
      pushUserMessage,
      pushAssistantMessage,
      pushToolMessage,
    };

    const waitForEvent = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(stopError);
    const drainAll = vi
      .fn()
      .mockReturnValueOnce([
        {
          type: "napcat_group_message",
          groupId: "123456",
          userId: "654321",
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
      contextManager,
      eventQueue,
      toolRegistry,
    });

    await expect(loop.run()).rejects.toBe(stopError);

    expect(waitForEvent).toHaveBeenCalledTimes(2);
    expect(drainAll).toHaveBeenCalled();
    expect(pushUserMessage).toHaveBeenCalledWith(
      [
        "[NAPCAT_GROUP_MESSAGE]",
        "group_id=123456",
        "user_id=654321",
        "message_id=1001",
        "time=1710000000",
        "raw_message=hello",
      ].join("\n"),
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith({
      system: "system-prompt",
      messages: [],
      tools: [
        toolRegistry.search_web.tool,
        toolRegistry.send_group_message.tool,
        toolRegistry.finish.tool,
      ],
      toolChoice: "auto",
    });
    expect(pushAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
      }),
    );
    expect(finishExecute).toHaveBeenCalledWith({});
    expect(disabledExecute).not.toHaveBeenCalled();
    expect(sendGroupMessageExecute).not.toHaveBeenCalled();
    expect(pushToolMessage).toHaveBeenCalledWith("tool-call-1", JSON.stringify({ finished: true }));
  });

  it("should throw when an enabled tool is missing from registry", () => {
    const llmClient: LlmClient = {
      chat: vi.fn(),
      listAvailableProviders: vi.fn().mockReturnValue([]),
    };
    const contextManager: AgentContextManager = {
      getSystemPrompt: vi.fn().mockReturnValue("system-prompt"),
      getMessages: vi.fn().mockReturnValue([]),
      getSteps: vi.fn().mockReturnValue(0),
      pushUserMessage: vi.fn(),
      pushAssistantMessage: vi.fn(),
      pushToolMessage: vi.fn(),
    };
    const eventQueue: AgentEventQueue = {
      enqueue: vi.fn().mockReturnValue(1),
      drainAll: vi.fn().mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
      waitForEvent: vi.fn(),
    };

    expect(
      () =>
        new AgentLoop({
          llmClient,
          contextManager,
          eventQueue,
          toolRegistry: {},
        }),
    ).toThrowError("Agent tool is not registered: search_web");
  });
});
