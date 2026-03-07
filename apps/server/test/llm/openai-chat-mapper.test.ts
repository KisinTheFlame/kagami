import { describe, expect, it } from "vitest";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { toLlmChatResponsePayload } from "../../src/llm/mappers/openai-chat-mapper.js";
import { z } from "zod";

describe("toLlmChatResponsePayload", () => {
  it("should map OpenAI completion to serializable payload only", () => {
    const completion = {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1710000000,
      model: "gpt-test",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: '{"ok":true}',
            refusal: null,
            annotations: [],
            audio: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "send_group_message",
                  arguments: '{"message":"hello"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
      },
    } as ChatCompletion;

    const payload = toLlmChatResponsePayload(completion, "openai");

    expect(payload).toEqual({
      provider: "openai",
      model: "gpt-test",
      message: {
        role: "assistant",
        content: '{"ok":true}',
        toolCalls: [
          {
            id: "call-1",
            name: "send_group_message",
            arguments: {
              message: "hello",
            },
          },
        ],
      },
      usage: {
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      },
    });
    expect(payload).not.toHaveProperty("text");
    expect(payload).not.toHaveProperty("json");
    expect(payload).not.toHaveProperty("toolCalls");
  });
});

describe("llm response payload", () => {
  it("should expose text, parsed json, and tool calls directly from payload", () => {
    const response = {
      provider: "deepseek" as const,
      model: "deepseek-chat",
      message: {
        role: "assistant" as const,
        content: '{"value":42}',
        toolCalls: [{ id: "call-1", name: "finish", arguments: { done: true } }],
      },
      usage: {
        totalTokens: 10,
      },
    };

    expect(response.message.content).toBe('{"value":42}');
    expect(z.object({ value: z.number() }).parse(JSON.parse(response.message.content))).toEqual({
      value: 42,
    });
    expect(response.message.toolCalls).toEqual([
      { id: "call-1", name: "finish", arguments: { done: true } },
    ]);
  });
});
