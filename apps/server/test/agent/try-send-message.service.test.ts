import { describe, expect, it, vi } from "vitest";
import {
  DecideReplyTool,
  TrySendMessageService,
} from "../../src/agents/subagents/reply-sender/index.js";
import { createReplyDecisionReminderMessage } from "../../src/context/context-message-factory.js";
import type { LlmClient } from "../../src/llm/client.js";
import type { LlmChatResponsePayload } from "../../src/llm/types.js";
import { ToolCatalog } from "../../src/tools/index.js";

function createReplySenderService(params?: {
  chat?: ReturnType<typeof vi.fn>;
  sendGroupMessage?: ReturnType<typeof vi.fn>;
}) {
  const chat = params?.chat ?? vi.fn();
  const llmClient: LlmClient = {
    chat,
    chatDirect: vi.fn(),
    listAvailableProviders: vi.fn().mockResolvedValue([]),
  };
  const agentMessageService = {
    sendGroupMessage: params?.sendGroupMessage ?? vi.fn().mockResolvedValue({ messageId: 9527 }),
  };
  const toolCatalog = new ToolCatalog([new DecideReplyTool()]);

  return {
    service: new TrySendMessageService({
      llmClient,
      agentMessageService,
      replyDecisionTools: toolCatalog.pick(["decide_reply"]),
    }),
    chat,
    agentMessageService,
  };
}

describe("TrySendMessageService", () => {
  it("should include mention syntax guidance in reply decision reminder", () => {
    expect(createReplyDecisionReminderMessage().content).toContain("使用 `{@昵称(qq)}` 格式");
  });

  it("should return sent=false when decider rejects sending", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "claude-code",
      model: "claude-test",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "decide-1",
            name: "decide_reply",
            arguments: {
              shouldSend: false,
              message: "",
            },
          },
        ],
      },
    } satisfies LlmChatResponsePayload);
    const { service, agentMessageService } = createReplySenderService({ chat });

    await expect(
      service.trySend({
        systemPrompt: "system-prompt",
        contextMessages: [{ role: "user", content: "hello" }],
      }),
    ).resolves.toEqual({
      sent: false,
    });

    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(
      {
        system: "system-prompt",
        messages: [
          {
            role: "user",
            content: "hello",
          },
          createReplyDecisionReminderMessage(),
        ],
        tools: [
          {
            name: "decide_reply",
            description: "最终裁决这次是否发送群消息；若发送，则同时给出最终要发送的文本。",
            parameters: {
              type: "object",
              properties: {
                shouldSend: {
                  type: "boolean",
                  description: "这次是否应该真的发送群消息。",
                },
                message: {
                  type: "string",
                  description: "最终要发送的群消息文本；不发送时传空字符串。",
                },
              },
            },
          },
        ],
        toolChoice: "required",
      },
      {
        usage: "replyDecider",
      },
    );
    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("should send the final message after decider approves", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "claude-code",
      model: "claude-test",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "decide-1",
            name: "decide_reply",
            arguments: {
              shouldSend: true,
              message: "你这波属实有点典了",
            },
          },
        ],
      },
    } satisfies LlmChatResponsePayload);
    const sendGroupMessage = vi.fn().mockResolvedValue({ messageId: 9527 });
    const { service } = createReplySenderService({
      chat,
      sendGroupMessage,
    });

    await expect(
      service.trySend({
        systemPrompt: "system-prompt",
        contextMessages: [{ role: "user", content: "hello" }],
      }),
    ).resolves.toEqual({
      sent: true,
      message: "你这波属实有点典了",
      messageId: 9527,
    });

    expect(chat).toHaveBeenCalledWith(
      {
        system: "system-prompt",
        messages: [
          {
            role: "user",
            content: "hello",
          },
          createReplyDecisionReminderMessage(),
        ],
        tools: [
          {
            name: "decide_reply",
            description: "最终裁决这次是否发送群消息；若发送，则同时给出最终要发送的文本。",
            parameters: {
              type: "object",
              properties: {
                shouldSend: {
                  type: "boolean",
                  description: "这次是否应该真的发送群消息。",
                },
                message: {
                  type: "string",
                  description: "最终要发送的群消息文本；不发送时传空字符串。",
                },
              },
            },
          },
        ],
        toolChoice: "required",
      },
      {
        usage: "replyDecider",
      },
    );
    expect(sendGroupMessage).toHaveBeenCalledWith({
      message: "你这波属实有点典了",
    });
  });

  it("should return sent=false when decider requests send but message is empty", async () => {
    const chat = vi.fn().mockResolvedValue({
      provider: "claude-code",
      model: "claude-test",
      message: {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "decide-1",
            name: "decide_reply",
            arguments: {
              shouldSend: true,
              message: "  ",
            },
          },
        ],
      },
    } satisfies LlmChatResponsePayload);
    const { service, agentMessageService } = createReplySenderService({ chat });

    await expect(
      service.trySend({
        systemPrompt: "system-prompt",
        contextMessages: [{ role: "user", content: "hello" }],
      }),
    ).resolves.toEqual({
      sent: false,
    });

    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
  });
});
