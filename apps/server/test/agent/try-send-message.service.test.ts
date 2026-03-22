import { describe, expect, it, vi } from "vitest";
import {
  ReplyThoughtTool,
  ReviewReplyStrategyTool,
  TrySendMessageService,
  WriteReplyMessageTool,
} from "../../src/agents/subagents/reply-sender/index.js";
import {
  createReplyThoughtMessage,
  createReplyThoughtReminderMessage,
  createReplyReviewReminderMessage,
  createReplyWriterReminderMessage,
} from "../../src/context/context-message-factory.js";
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
  const toolCatalog = new ToolCatalog([
    new ReplyThoughtTool(),
    new ReviewReplyStrategyTool(),
    new WriteReplyMessageTool(),
  ]);

  return {
    service: new TrySendMessageService({
      llmClient,
      agentMessageService,
      replyThoughtTools: toolCatalog.pick(["reply_thought"]),
      replyReviewTools: toolCatalog.pick(["review_reply_strategy"]),
      replyWriterTools: toolCatalog.pick(["write_reply_message"]),
    }),
    chat,
    agentMessageService,
  };
}

describe("TrySendMessageService", () => {
  it("should include mention syntax guidance in reply writer reminder", () => {
    expect(createReplyWriterReminderMessage("短一点").content).toContain("使用 `{@昵称(qq)}` 格式");
  });

  it("should return sent=false when review rejects the strategy", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "thought-1",
              name: "reply_thought",
              arguments: {
                thought: "这次不如先别回，但如果要回可以接梗。",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload)
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "review-1",
              name: "review_reply_strategy",
              arguments: {
                approve: false,
                thought: "这会儿插话有点硬。",
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

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenNthCalledWith(
      1,
      {
        system: "system-prompt",
        messages: [
          {
            role: "user",
            content: "hello",
          },
          createReplyThoughtReminderMessage(),
        ],
        tools: [
          {
            name: "reply_thought",
            description: "写下这次是否值得回复、最值得接的点，以及一个简短的回复方向提示。",
            parameters: {
              type: "object",
              properties: {
                thought: {
                  type: "string",
                  description: "本次回复思考，需包含是否该回复、回复角度和简短草稿提示。",
                },
              },
            },
          },
        ],
        toolChoice: {
          tool_name: "reply_thought",
        },
      },
      {
        usage: "replyThought",
      },
    );
    expect(chat).toHaveBeenNthCalledWith(
      2,
      {
        system: "system-prompt",
        messages: [
          {
            role: "user",
            content: "hello",
          },
          createReplyThoughtMessage("这次不如先别回，但如果要回可以接梗。"),
          createReplyReviewReminderMessage(),
        ],
        tools: [
          {
            name: "review_reply_strategy",
            description: "审核当前回复策略是否值得执行，并给出简短审核意见。",
            parameters: {
              type: "object",
              properties: {
                approve: {
                  type: "boolean",
                  description: "当前回复策略是否值得执行。",
                },
                thought: {
                  type: "string",
                  description: "简短审核意见；通过时可写成最终写作约束。",
                },
              },
            },
          },
        ],
        toolChoice: {
          tool_name: "review_reply_strategy",
        },
      },
      {
        usage: "replyReview",
      },
    );
    expect(agentMessageService.sendGroupMessage).not.toHaveBeenCalled();
  });

  it("should write and send a final message after approval", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "thought-1",
              name: "reply_thought",
              arguments: {
                thought: "可以接刚才那个吐槽，方向是轻轻阴阳一句。",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload)
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "review-1",
              name: "review_reply_strategy",
              arguments: {
                approve: true,
                thought: "短一点，顺着梗接，不要像解释。",
              },
            },
          ],
        },
      } satisfies LlmChatResponsePayload)
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-test",
        message: {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "writer-1",
              name: "write_reply_message",
              arguments: {
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

    expect(chat).toHaveBeenNthCalledWith(
      3,
      {
        system: "system-prompt",
        messages: [
          {
            role: "user",
            content: "hello",
          },
          createReplyThoughtMessage("可以接刚才那个吐槽，方向是轻轻阴阳一句。"),
          createReplyWriterReminderMessage("短一点，顺着梗接，不要像解释。"),
        ],
        tools: [
          {
            name: "write_reply_message",
            description: "写出本次要发送到群里的最终文本消息。",
            parameters: {
              type: "object",
              properties: {
                message: {
                  type: "string",
                  description: "最终要发送的群消息文本；如需提及成员，使用 `{@昵称(qq)}`。",
                },
              },
            },
          },
        ],
        toolChoice: {
          tool_name: "write_reply_message",
        },
      },
      {
        usage: "replyWriter",
      },
    );
    expect(sendGroupMessage).toHaveBeenCalledWith({
      message: "你这波属实有点典了",
    });
  });
});
