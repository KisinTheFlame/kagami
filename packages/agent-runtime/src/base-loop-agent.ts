import type { LoopAgent } from "./loop-agent.js";
import type { LoopAgentEventsConsumedSummary, LoopAgentExtension } from "./loop-agent-extension.js";
import type {
  AssistantLikeMessage,
  ReActKernel,
  ReActKernelRunRoundInput,
  ReActRoundResult,
} from "./react-kernel.js";

type BaseLoopAgentTickSummary<
  TMessage extends { role: string },
  TCompletion extends {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
  TExtensionData,
> = {
  didRunRound: boolean;
  roundResult: ReActRoundResult<TMessage, TCompletion, TExtensionData> | null;
};

export abstract class BaseLoopAgent<
  TMessage extends { role: string },
  TUsage extends string,
  TCompletion extends {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
  TExtensionData = unknown,
  TLoopExtensionContext = void,
> implements LoopAgent {
  private readonly kernel: ReActKernel<TMessage, TUsage, TCompletion, TExtensionData>;
  private readonly extensions: LoopAgentExtension<
    TLoopExtensionContext,
    TMessage,
    TUsage,
    TCompletion,
    TExtensionData
  >[];
  private readonly sleep: (ms: number) => Promise<void>;
  private startPromise: Promise<void> | null = null;
  private activeTickPromise: Promise<unknown> | null = null;
  private initialized = false;
  private stopRequested = false;

  protected constructor({
    kernel,
    extensions,
    sleep,
  }: {
    kernel: ReActKernel<TMessage, TUsage, TCompletion, TExtensionData>;
    extensions?: LoopAgentExtension<
      TLoopExtensionContext,
      TMessage,
      TUsage,
      TCompletion,
      TExtensionData
    >[];
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.kernel = kernel;
    this.extensions = extensions ?? [];
    this.sleep = sleep ?? defaultSleep;
  }

  public async start(): Promise<void> {
    if (this.startPromise) {
      return await this.startPromise;
    }

    this.stopRequested = false;
    const loopPromise = this.runLoop();
    this.startPromise = loopPromise;

    try {
      await loopPromise;
    } finally {
      if (this.startPromise === loopPromise) {
        this.startPromise = null;
      }
    }
  }

  public async stop(): Promise<void> {
    this.stopRequested = true;
    const startPromise = this.startPromise;
    if (!startPromise) {
      return;
    }

    await startPromise.catch(() => undefined);
  }

  protected abstract initializeHostIfNeeded(): Promise<void>;
  protected abstract createLoopExtensionContext(): TLoopExtensionContext;
  protected abstract beforeTick(): Promise<LoopAgentEventsConsumedSummary | void>;
  protected abstract shouldRunRound(): Promise<boolean>;
  protected abstract buildRoundInput(): Promise<ReActKernelRunRoundInput<TMessage, TUsage> | null>;
  protected abstract commitRoundResult(
    result: ReActRoundResult<TMessage, TCompletion, TExtensionData>,
  ): Promise<void>;

  protected async executeRound(
    input: ReActKernelRunRoundInput<TMessage, TUsage>,
  ): Promise<ReActRoundResult<TMessage, TCompletion, TExtensionData>> {
    return await this.kernel.runRound(input);
  }

  protected async afterTick(
    summary: BaseLoopAgentTickSummary<TMessage, TCompletion, TExtensionData>,
  ): Promise<number | void> {
    void summary;
  }

  protected async onUnhandledError(error: unknown): Promise<void> {
    throw error;
  }

  protected async waitForActiveTick(): Promise<void> {
    const activeTickPromise = this.activeTickPromise;
    if (!activeTickPromise) {
      return;
    }

    await activeTickPromise.catch(() => undefined);
  }

  protected async ensureInitialized(): Promise<void> {
    await this.initializeHostIfNeeded();
    if (this.initialized) {
      return;
    }

    const context = this.createLoopExtensionContext();
    for (const extension of this.extensions) {
      await extension.onInitialize?.(context);
    }
    this.initialized = true;
  }

  protected async notifyAfterReset(): Promise<void> {
    const context = this.createLoopExtensionContext();
    for (const extension of this.extensions) {
      await extension.onAfterReset?.(context);
    }
  }

  private async runLoop(): Promise<void> {
    try {
      await this.ensureInitialized();

      while (!this.stopRequested) {
        const tickPromise = this.runSingleTick();
        this.activeTickPromise = tickPromise;

        try {
          await tickPromise;
        } finally {
          if (this.activeTickPromise === tickPromise) {
            this.activeTickPromise = null;
          }
        }
      }
    } catch (error) {
      try {
        await this.onUnhandledError(error);
      } catch {
        void error;
      }
      try {
        const context = this.createLoopExtensionContext();
        for (const extension of this.extensions) {
          await extension.onUnhandledError?.({
            context,
            error,
          });
        }
      } catch {
        void error;
      }
      throw error;
    }
  }

  protected async runSingleTick(): Promise<
    BaseLoopAgentTickSummary<TMessage, TCompletion, TExtensionData>
  > {
    let roundResult: ReActRoundResult<TMessage, TCompletion, TExtensionData> | null = null;
    let didRunRound = false;

    const beforeTickSummary = (await this.beforeTick()) ?? {
      shouldTriggerRound: false,
    };
    const context = this.createLoopExtensionContext();
    for (const extension of this.extensions) {
      await extension.onAfterEventsConsumed?.({
        context,
        summary: beforeTickSummary,
      });
    }
    if (this.stopRequested) {
      return {
        didRunRound,
        roundResult,
      };
    }

    if (await this.shouldRunRound()) {
      for (const extension of this.extensions) {
        await extension.onBeforeRound?.(context);
      }

      const roundInput = await this.buildRoundInput();
      if (roundInput) {
        roundResult = await this.executeRound(roundInput);
        for (const extension of this.extensions) {
          await extension.onAfterRound?.({
            context,
            roundInput,
            result: roundResult,
          });
        }
        if (roundResult.shouldCommit) {
          await this.commitRoundResult(roundResult);
          for (const extension of this.extensions) {
            await extension.onAfterCommit?.({
              context,
              result: roundResult,
            });
          }
        }
        didRunRound = true;
      }
    }

    if (!didRunRound) {
      for (const extension of this.extensions) {
        await extension.onIdle?.(context);
      }
    }

    const sleepMs = await this.afterTick({
      didRunRound,
      roundResult,
    });
    if (!this.stopRequested && sleepMs && sleepMs > 0) {
      await this.sleep(sleepMs);
    }

    return {
      didRunRound,
      roundResult,
    };
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}
