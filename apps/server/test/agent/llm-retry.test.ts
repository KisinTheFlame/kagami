import { ReActKernel, ToolCatalog } from "@kagami/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import { BizError } from "../../src/common/errors/biz-error.js";
import {
  LoopLlmRetryExtension,
  type RetryBackoffPolicy,
} from "../../src/agent/runtime/llm-retry.js";
import type { LlmChatResponsePayload, LlmMessage } from "../../src/llm/types.js";

describe("LoopLlmRetryExtension", () => {
  it("increments retry attempts and resets backoff after a successful model call", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn();
    const backoffPolicy: RetryBackoffPolicy = {
      nextDelayMs: ({ attempt }) => attempt * 1_000,
      reset,
    };
    const kernel = new ReActKernel<LlmMessage, "agent", LlmChatResponsePayload>({
      model: {
        chat: vi
          .fn()
          .mockRejectedValueOnce(
            new BizError({
              message: "LLM 上游服务调用失败",
            }),
          )
          .mockRejectedValueOnce(
            new BizError({
              message: "LLM 上游服务调用失败",
            }),
          )
          .mockResolvedValueOnce({
            provider: "openai",
            model: "gpt-test",
            message: {
              role: "assistant",
              content: "",
              toolCalls: [],
            },
          })
          .mockRejectedValueOnce(
            new BizError({
              message: "所选 LLM provider 当前不可用",
            }),
          ),
      },
      extensions: [
        new LoopLlmRetryExtension({
          backoffPolicy,
          sleep,
          onRecoverableError: vi.fn(),
        }),
      ],
    });
    const request = {
      state: {
        systemPrompt: "system",
        messages: [
          {
            role: "user",
            content: "hello",
          } satisfies Extract<LlmMessage, { role: "user" }>,
        ],
      },
      tools: new ToolCatalog<LlmMessage>([]).pick([]),
      usage: "agent" as const,
    };

    const first = await kernel.runRound(request);
    const second = await kernel.runRound(request);
    const third = await kernel.runRound(request);
    const fourth = await kernel.runRound(request);

    expect(first.shouldContinue).toBe(true);
    expect(second.shouldContinue).toBe(true);
    expect(third.shouldContinue).toBe(false);
    expect(fourth.shouldContinue).toBe(true);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([1_000, 2_000, 1_000]);
    expect(reset).toHaveBeenCalledOnce();
  });
});
