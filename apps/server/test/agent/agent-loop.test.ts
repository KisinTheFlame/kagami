import { describe, expect, it, vi } from "vitest";
import { AgentLoop } from "../../src/agent/agent-loop.js";
import type { AgentContextManager } from "../../src/agent/context-manager.manager.js";
import type { AgentEventQueue } from "../../src/agent/event-queue.queue.js";
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
  it("should consume queue events and execute one tool round with injected mocks", async () => {
    const stopError = new StopLoopError("stop-loop");

    const chat = vi.fn().mockResolvedValue(createLlmResponse());
    const llmClient: LlmClient = {
      chat,
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
      toolExecutionDeps: {
        sendGroupMessage: vi.fn().mockResolvedValue({ messageId: 1 }),
      },
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
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "system-prompt",
        messages: [],
        toolChoice: "auto",
      }),
    );
    expect(pushAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
      }),
    );
    expect(pushToolMessage).toHaveBeenCalledWith("tool-call-1", JSON.stringify({ finished: true }));
  });
});
