import { describe, expect, it } from "vitest";
import type { ChatCompletion } from "openai/resources/chat/completions";
import {
  toLlmChatResponsePayload,
  toOpenAiChatRequest,
} from "../src/mappers/openai-chat-mapper.js";
import { isRetryableLlmFailure } from "../src/retryable-error.js";
import { z } from "zod";

describe("toOpenAiChatRequest", () => {
  it("should map multimodal user content to OpenAI chat content parts", () => {
    const payload = toOpenAiChatRequest({
      model: "gpt-4o-mini",
      request: {
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请描述图片内容",
              },
              {
                type: "image",
                content: Buffer.from("hello").toString("base64"),
                mimeType: "image/png",
                filename: "hello.png",
              },
            ],
          },
        ],
        tools: [],
        toolChoice: "none",
      },
    });

    expect(payload).toEqual({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请描述图片内容",
            },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,aGVsbG8=",
              },
            },
          ],
        },
      ],
    });
  });
});

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
                  name: "send_message",
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
        prompt_tokens_details: {
          cached_tokens: 5,
        },
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
            name: "send_message",
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
        cacheHitTokens: 5,
        cacheMissTokens: 6,
      },
    });
    expect(payload).not.toHaveProperty("text");
    expect(payload).not.toHaveProperty("json");
    expect(payload).not.toHaveProperty("toolCalls");
  });

  it("should map DeepSeek cache hit and miss tokens directly", () => {
    const completion = {
      id: "chatcmpl-2",
      object: "chat.completion",
      created: 1710000001,
      model: "deepseek-chat",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          logprobs: null,
          message: {
            role: "assistant",
            content: "pong",
            refusal: null,
            annotations: [],
            audio: null,
          },
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 6,
        total_tokens: 26,
        prompt_cache_hit_tokens: 12,
        prompt_cache_miss_tokens: 8,
      },
    } as ChatCompletion;

    expect(toLlmChatResponsePayload(completion, "deepseek")).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      message: {
        role: "assistant",
        content: "pong",
        toolCalls: [],
      },
      usage: {
        promptTokens: 20,
        completionTokens: 6,
        totalTokens: 26,
        cacheHitTokens: 12,
        cacheMissTokens: 8,
      },
    });
  });

  function completionWithToolArgs(argumentsJson: string): ChatCompletion {
    return {
      id: "chatcmpl-x",
      object: "chat.completion",
      created: 1710000002,
      model: "gpt-test",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content: "",
            refusal: null,
            annotations: [],
            audio: null,
            tool_calls: [
              {
                id: "call-x",
                type: "function",
                function: { name: "do_thing", arguments: argumentsJson },
              },
            ],
          },
        },
      ],
    } as ChatCompletion;
  }

  it("throws a retryable INVALID_TOOL_ARGUMENTS on malformed tool-call JSON", () => {
    let caught: unknown;
    try {
      toLlmChatResponsePayload(completionWithToolArgs("{not json"), "openai");
    } catch (error) {
      caught = error;
    }
    expect(isRetryableLlmFailure(caught)).toBe(true);
    expect((caught as { meta?: { reason?: string } }).meta?.reason).toBe("INVALID_TOOL_ARGUMENTS");
  });

  it("throws INVALID_TOOL_ARGUMENTS when tool-call args are valid JSON but not an object", () => {
    // 数组 / 标量都是合法 JSON 但不是工具参数对象——`as Record` 曾让它们蒙混进下游。
    expect(() => toLlmChatResponsePayload(completionWithToolArgs("[1,2,3]"), "openai")).toThrow();
    expect(() => toLlmChatResponsePayload(completionWithToolArgs("42"), "openai")).toThrow();
  });

  it("throws a retryable EMPTY_CHOICES when the completion has no choices", () => {
    const empty = {
      id: "chatcmpl-empty",
      object: "chat.completion",
      created: 1710000003,
      model: "gpt-test",
      choices: [],
    } as unknown as ChatCompletion;
    let caught: unknown;
    try {
      toLlmChatResponsePayload(empty, "openai");
    } catch (error) {
      caught = error;
    }
    expect(isRetryableLlmFailure(caught)).toBe(true);
    expect((caught as { meta?: { reason?: string } }).meta?.reason).toBe("EMPTY_CHOICES");
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
