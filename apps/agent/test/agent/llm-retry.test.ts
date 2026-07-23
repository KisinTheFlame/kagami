import { NoopEffectInterpreter, ReActKernel, ToolCatalog } from "@kagami/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  LoopLlmRetryExtension,
  type RetryBackoffPolicy,
} from "../../src/agent/runtime/llm-retry.js";
import {
  llmProviderUnavailableError,
  llmUpstreamCallFailedError,
  type LlmChatResponsePayload,
  type LlmMessage,
} from "@kagami/llm-client";

describe("LoopLlmRetryExtension", () => {
  it("increments retry attempts and resets backoff after a successful model call", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const reset = vi.fn();
    const backoffPolicy: RetryBackoffPolicy = {
      nextDelayMs: ({ attempt }) => attempt * 1_000,
      reset,
    };
    const kernel = new ReActKernel<"agent", LlmChatResponsePayload>({
      model: {
        chat: vi
          .fn()
          .mockRejectedValueOnce(llmUpstreamCallFailedError())
          .mockRejectedValueOnce(llmUpstreamCallFailedError())
          .mockResolvedValueOnce({
            provider: "openai",
            model: "gpt-test",
            message: {
              role: "assistant",
              content: "",
              toolCalls: [],
            },
          })
          .mockRejectedValueOnce(llmProviderUnavailableError()),
      },
      interpreter: new NoopEffectInterpreter(),
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
      tools: new ToolCatalog([]).pick([]),
      usage: "agent" as const,
      scene: "agent",
    };

    const first = await kernel.runRound(request);
    const second = await kernel.runRound(request);
    const third = await kernel.runRound(request);
    const fourth = await kernel.runRound(request);

    // The first three rounds were retries that all failed; their commit
    // status reflects whether the kernel gave up. The fourth round is a
    // successful round. In the current model shouldContinue has been
    // removed, so we only assert on shouldCommit / sleep call counts.
    // Calls 1, 2 fail and the retry extension returns handled=true, so the
    // kernel returns shouldCommit: false. Call 3 succeeds and commits.
    // Call 4 fails again and the retry extension handles it, returning
    // shouldCommit: false.
    expect(first.shouldCommit).toBe(false);
    expect(second.shouldCommit).toBe(false);
    expect(third.shouldCommit).toBe(true);
    expect(fourth.shouldCommit).toBe(false);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([1_000, 2_000, 1_000]);
    expect(reset).toHaveBeenCalledOnce();
  });
});
