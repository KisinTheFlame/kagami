import type { LlmMessage } from "@kagami/llm";
import type { LoopAgent } from "./loop-agent.js";
import type { LoopAgentExtension } from "./loop-agent-extension.js";
import type {
  AssistantLikeMessage,
  ReActKernel,
  ReActKernelRunRoundInput,
  ReActRoundResult,
} from "./react-kernel.js";

/**
 * BaseLoopAgent: a minimal single-layer infinite loop agent.
 *
 * The loop is conceptually:
 *
 *   while (!stopRequested) {
 *     await runOnce();
 *   }
 *
 * `runOnce` is abstract. Subclasses decide what "one iteration" means. The
 * canonical pattern is: drain any pending events into the context, then run
 * one ReAct round. Inside that round, tools may suspend on a Queue —
 * this is how the agent "pauses" when there is nothing to do.
 *
 * There is no tick, no polling, no "sleep between iterations". If the loop
 * appears idle, it is because a tool is internally blocking on a producer.
 *
 * The helper `runReactRound()` is provided for subclasses that want the
 * standard orchestration of onBeforeRound / onAfterRound / onAfterCommit
 * extension hooks around a single kernel round.
 */
export abstract class BaseLoopAgent<
  TUsage extends string,
  TCompletion extends {
    message: Extract<LlmMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
  TExtensionData = unknown,
  TLoopExtensionContext = void,
> implements LoopAgent {
  private readonly kernel: ReActKernel<TUsage, TCompletion, TExtensionData>;
  protected readonly extensions: LoopAgentExtension<
    TLoopExtensionContext,
    TUsage,
    TCompletion,
    TExtensionData
  >[];
  private startPromise: Promise<void> | null = null;
  private activeRunOncePromise: Promise<void> | null = null;
  private initialized = false;
  protected stopRequested = false;

  protected constructor({
    kernel,
    extensions,
  }: {
    kernel: ReActKernel<TUsage, TCompletion, TExtensionData>;
    extensions?: LoopAgentExtension<TLoopExtensionContext, TUsage, TCompletion, TExtensionData>[];
  }) {
    this.kernel = kernel;
    this.extensions = extensions ?? [];
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
    // Wake the loop if it's blocking inside a tool that awaits an event queue.
    this.onStopRequested();
    const startPromise = this.startPromise;
    if (!startPromise) {
      return;
    }
    await startPromise.catch(() => undefined);
  }

  /**
   * Subclass hook: called when stop() is invoked. Must synchronously push
   * something onto whatever queue(s) the agent's blocking tools await, so
   * the blocked tool unblocks and the round can end promptly. Default: no-op.
   */
  protected onStopRequested(): void {}

  protected abstract initializeHostIfNeeded(): Promise<void>;
  protected abstract createLoopExtensionContext(): TLoopExtensionContext;

  /**
   * One iteration of the main loop. The canonical implementation is:
   *   1. drain any pending events into the agent context
   *   2. call runReactRound() to execute a single LLM+tools round
   * Inside the round, a blocking tool (e.g. `wait`) may await an event queue.
   *
   * Subclasses MUST implement this.
   */
  protected abstract runOnce(): Promise<void>;

  protected abstract buildRoundInput(): Promise<ReActKernelRunRoundInput<TUsage> | null>;
  protected abstract commitRoundResult(
    result: ReActRoundResult<TCompletion, TExtensionData>,
  ): Promise<void>;

  /**
   * Helper: run one React round with all extension hooks. Subclasses call
   * this from within runOnce() when they want to actually call the LLM.
   *
   * Returns the round result (or null if buildRoundInput returned null,
   * meaning the round was skipped).
   */
  protected async runReactRound(): Promise<ReActRoundResult<TCompletion, TExtensionData> | null> {
    const context = this.createLoopExtensionContext();
    for (const extension of this.extensions) {
      await extension.onBeforeRound?.(context);
    }

    const roundInput = await this.buildRoundInput();
    if (!roundInput) {
      return null;
    }

    const roundResult = await this.executeRound(roundInput);
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

    return roundResult;
  }

  protected async executeRound(
    input: ReActKernelRunRoundInput<TUsage>,
  ): Promise<ReActRoundResult<TCompletion, TExtensionData>> {
    return await this.kernel.runRound(input);
  }

  protected async onUnhandledError(error: unknown): Promise<void> {
    throw error;
  }

  protected async waitForActiveRunOnce(): Promise<void> {
    const activeRunOncePromise = this.activeRunOncePromise;
    if (!activeRunOncePromise) {
      return;
    }
    await activeRunOncePromise.catch(() => undefined);
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

  protected async notifyContextCompacted(): Promise<void> {
    const context = this.createLoopExtensionContext();
    for (const extension of this.extensions) {
      await extension.onContextCompacted?.(context);
    }
  }

  private async runLoop(): Promise<void> {
    try {
      await this.ensureInitialized();

      while (!this.stopRequested) {
        const runOncePromise = this.runOnce();
        this.activeRunOncePromise = runOncePromise;

        try {
          await runOncePromise;
        } finally {
          if (this.activeRunOncePromise === runOncePromise) {
            this.activeRunOncePromise = null;
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
}
