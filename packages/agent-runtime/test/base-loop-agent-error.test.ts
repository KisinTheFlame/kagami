import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@kagami/llm";
import { BaseLoopAgent } from "../src/base-loop-agent.js";
import type { LoopAgentExtension } from "../src/loop-agent-extension.js";
import type {
  AssistantLikeMessage,
  ReActKernel,
  ReActKernelRunRoundInput,
  ReActRoundResult,
} from "../src/react-kernel.js";

type MinimalCompletion = {
  message: Extract<LlmMessage, { role: "assistant" }> & AssistantLikeMessage;
};

type TestExtension = LoopAgentExtension<void, string, MinimalCompletion, unknown>;

/**
 * 最小可跑子类：runOnce 立即抛出 loopError（模拟主循环崩溃），不触碰 kernel。
 * onUnhandledError / 扩展的 onUnhandledError 是否抛次生错误由构造参数控制。
 */
class TestLoopAgent extends BaseLoopAgent<string, MinimalCompletion> {
  public constructor(
    private readonly opts: {
      loopError: unknown;
      handlerError?: unknown;
      extensions?: TestExtension[];
    },
  ) {
    super({
      kernel: {} as unknown as ReActKernel<string, MinimalCompletion, unknown>,
      extensions: opts.extensions,
    });
  }

  protected async initializeHostIfNeeded(): Promise<void> {}
  protected createLoopExtensionContext(): void {}
  protected async runOnce(): Promise<void> {
    throw this.opts.loopError;
  }
  protected async buildRoundInput(): Promise<ReActKernelRunRoundInput<string> | null> {
    return null;
  }
  protected async commitRoundResult(
    _result: ReActRoundResult<MinimalCompletion, unknown>,
  ): Promise<void> {}

  protected override async onUnhandledError(error: unknown): Promise<void> {
    if (this.opts.handlerError !== undefined) {
      throw this.opts.handlerError;
    }
    // 默认语义：把原错重新抛回（模拟基类默认 onUnhandledError）。
    throw error;
  }
}

describe("BaseLoopAgent — 主循环崩溃时的错误上报", () => {
  it("处理器把原错抛回时，identity 过滤，仍原样抛原错（不包 AggregateError）", async () => {
    const loopError = new Error("loop crashed");
    const agent = new TestLoopAgent({ loopError }); // handlerError 未设 → 抛回原错
    await expect(agent.start()).rejects.toBe(loopError);
  });

  it("onUnhandledError 抛出次生错误时，用 AggregateError 一并抛出，原错为首项", async () => {
    const loopError = new Error("loop crashed");
    const handlerError = new Error("logger sink broke");
    const agent = new TestLoopAgent({ loopError, handlerError });

    await expect(agent.start()).rejects.toThrow(AggregateError);
    const caught = await agent.start().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([loopError, handlerError]);
  });

  it("扩展的 onUnhandledError 抛错也被收集进 AggregateError", async () => {
    const loopError = new Error("loop crashed");
    const extError = new Error("extension handler broke");
    const extension: TestExtension = {
      onUnhandledError: () => {
        throw extError;
      },
    };
    // handlerError 未设 → 基类 onUnhandledError 抛回原错（被过滤），只剩扩展的次生错误。
    const agent = new TestLoopAgent({ loopError, extensions: [extension] });

    const caught = await agent.start().catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([loopError, extError]);
  });
});
