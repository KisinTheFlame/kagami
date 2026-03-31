import type {
  AssistantLikeMessage,
  ReActKernelExtension,
  ReActKernelRunRoundInput,
} from "@kagami/agent-runtime";
import { BizError } from "../../common/errors/biz-error.js";

export const DEFAULT_LLM_RETRY_BACKOFF_MS = 30_000;

export type RetryBackoffPolicy = {
  nextDelayMs(input: { attempt: number }): number;
  reset?(): void;
};

export class FixedRetryBackoffPolicy implements RetryBackoffPolicy {
  private readonly delayMs: number;

  public constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

  public nextDelayMs(): number {
    return this.delayMs;
  }

  public reset(): void {}
}

export function isRetryableLlmFailure(error: unknown): error is BizError {
  return (
    error instanceof BizError &&
    (error.message === "所选 LLM provider 当前不可用" || error.message === "LLM 上游服务调用失败")
  );
}

export class LoopLlmRetryExtension<
  TMessage extends { role: string },
  TUsage extends string,
  TCompletion extends {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
  TExtensionData = unknown,
> implements ReActKernelExtension<TMessage, TUsage, TCompletion, TExtensionData> {
  private readonly backoffPolicy: RetryBackoffPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onRecoverableError: (error: unknown) => Promise<void> | void;
  private readonly onBeforeRetry?:
    | ((input: {
        request: ReActKernelRunRoundInput<TMessage, TUsage>;
        error: unknown;
        delayMs: number;
        attempt: number;
      }) => Promise<void> | void)
    | undefined;
  private readonly onSuccessfulModelCall?:
    | ((input: {
        request: ReActKernelRunRoundInput<TMessage, TUsage>;
        completion: TCompletion;
      }) => Promise<void> | void)
    | undefined;
  private retryAttempt = 0;

  public constructor(input: {
    backoffPolicy: RetryBackoffPolicy;
    sleep: (ms: number) => Promise<void>;
    onRecoverableError: (error: unknown) => Promise<void> | void;
    onBeforeRetry?: (input: {
      request: ReActKernelRunRoundInput<TMessage, TUsage>;
      error: unknown;
      delayMs: number;
      attempt: number;
    }) => Promise<void> | void;
    onSuccessfulModelCall?: (input: {
      request: ReActKernelRunRoundInput<TMessage, TUsage>;
      completion: TCompletion;
    }) => Promise<void> | void;
  }) {
    this.backoffPolicy = input.backoffPolicy;
    this.sleep = input.sleep;
    this.onRecoverableError = input.onRecoverableError;
    this.onBeforeRetry = input.onBeforeRetry;
    this.onSuccessfulModelCall = input.onSuccessfulModelCall;
  }

  public async onAfterModel(input: {
    request: ReActKernelRunRoundInput<TMessage, TUsage>;
    completion: TCompletion;
  }): Promise<void> {
    this.retryAttempt = 0;
    this.backoffPolicy.reset?.();
    await this.onSuccessfulModelCall?.(input);
  }

  public async onModelError(input: {
    request: ReActKernelRunRoundInput<TMessage, TUsage>;
    error: unknown;
  }): Promise<{ handled: boolean; retry: boolean } | void> {
    if (!isRetryableLlmFailure(input.error)) {
      return;
    }

    this.retryAttempt += 1;
    const delayMs = this.backoffPolicy.nextDelayMs({
      attempt: this.retryAttempt,
    });

    await this.onRecoverableError(input.error);
    await this.onBeforeRetry?.({
      request: input.request,
      error: input.error,
      delayMs,
      attempt: this.retryAttempt,
    });
    await this.sleep(delayMs);

    return {
      handled: true,
      retry: true,
    };
  }
}
