import type { LlmMessage } from "@kagami/llm";
import type { TaskAgent } from "./agent-runtime.js";
import {
  HandlerEffectInterpreter,
  type Effect,
  type EffectHandler,
  type EffectHandlerResult,
  type EffectInterpreter,
} from "./effect.js";
import {
  ReActKernel,
  type AssistantLikeMessage,
  type ReActModel,
  type ReActToolCall,
  type ToolLikeMessage,
} from "./react-kernel.js";
import type { ToolExecutor } from "./tool/tool-catalog.js";
import type { ToolContext } from "./tool/tool-component.js";

export type TaskAgentToolCall = ReActToolCall;
export type { AssistantLikeMessage, ToolLikeMessage };
export type TaskAgentModel<TUsage extends string = string> = ReActModel<TUsage>;
export type TaskAgentInvoker<TInput, TOutput> = Pick<TaskAgent<TInput, TOutput>, "invoke">;

type TaskAgentCompletion = {
  message: Extract<LlmMessage, { role: "assistant" }> & AssistantLikeMessage;
};

export type TaskAgentInvocationState<TUsage extends string> = {
  systemPrompt?: string;
  messages: LlmMessage[];
  toolContext?: ToolContext;
  usage: TUsage;
};

/** TaskAgent 终止 Effect 的 type 字面量。 */
export const TERMINATE_EFFECT_TYPE = "terminate";

/**
 * TaskAgent 的循环退出 Effect。自带 `content` 字段——`buildResult` 用它作为入参。
 *
 * Effect 自描述：终止信号的"最终输出"由 Effect 自己携带，不依赖 tool 的
 * `result.content`。这样 `TaskEffectInterpreter` 能在不接收 "tool 上下文"
 * 的前提下产出 `TaskAgentControl.content`。
 */
export interface TerminateEffect extends Effect {
  readonly type: typeof TERMINATE_EFFECT_TYPE;
  readonly content: string;
}

/**
 * TaskAgent 的控制流信号。kernel 看到 Interpreter 返 `control` 后把它放进
 * `ReActRoundResult.control`，由 `BaseTaskAgent.invoke` 读出后退出循环。
 */
export type TaskAgentControl = {
  readonly kind: "stop";
  readonly content: string;
};

/**
 * 处理 `terminate` Effect 的 handler：翻译成 `TaskAgentControl.stop`，content
 * 取自 Effect 自带的 `content` 字段（Effect 自描述）。
 */
export class TerminateHandler implements EffectHandler<TaskAgentControl> {
  public matches(effect: Effect): boolean {
    return effect.type === TERMINATE_EFFECT_TYPE;
  }

  public async handle(effect: Effect): Promise<EffectHandlerResult<TaskAgentControl>> {
    const terminate = effect as TerminateEffect;
    return { control: { kind: "stop", content: terminate.content } };
  }
}

/**
 * TaskAgent 用的标准 EffectInterpreter。只装一个 `TerminateHandler`——TaskAgent
 * 不像 RootAgent 有切状态 / append message 这些副作用语义，遇到非 terminate 的
 * Effect 由 HandlerEffectInterpreter 抛错。
 */
export class TaskEffectInterpreter
  extends HandlerEffectInterpreter<TaskAgentControl>
  implements EffectInterpreter<TaskAgentControl>
{
  public constructor() {
    super([new TerminateHandler()]);
  }
}

/**
 * TaskAgent 跑满 maxRounds 仍未收到 terminate 信号时抛出。toolChoice auto 下模型
 * 可能持续纯文本轮不调终止工具，这是防死循环的兜底；调用方按各自语义降级
 * （web-search 以错误结果回流、summary 不压缩、todo 返回空建议）。
 */
export class TaskAgentMaxRoundsExceededError extends Error {
  public readonly maxRounds: number;

  public constructor(maxRounds: number) {
    super(`TaskAgent exceeded max rounds (${String(maxRounds)}) without a terminate signal`);
    this.name = "TaskAgentMaxRoundsExceededError";
    this.maxRounds = maxRounds;
  }
}

export abstract class BaseTaskAgent<
  TInput,
  TOutput,
  TUsage extends string = string,
> implements TaskAgent<TInput, TOutput> {
  private readonly kernel: ReActKernel<TUsage, TaskAgentCompletion, unknown, TaskAgentControl>;
  private readonly taskTools: ToolExecutor;
  private readonly maxRounds: number;

  public constructor({
    kernel,
    model,
    interpreter,
    taskTools,
    maxRounds,
  }: {
    kernel?: ReActKernel<TUsage, TaskAgentCompletion, unknown, TaskAgentControl>;
    model?: TaskAgentModel<TUsage>;
    /**
     * 解释 Effect 的 Interpreter。不传则用默认 `TaskEffectInterpreter`——它认识
     * `terminate` Effect 并产 stop control。子类需要识别更多 Effect（罕见）时
     * 自己实现并传入。
     */
    interpreter?: EffectInterpreter<TaskAgentControl>;
    taskTools: ToolExecutor;
    /** 轮数上限，每次 kernel.runRound 计 1 轮（含零工具调用的纯文本轮）。 */
    maxRounds: number;
  }) {
    if (!Number.isInteger(maxRounds) || maxRounds <= 0) {
      throw new Error("BaseTaskAgent requires a positive integer maxRounds");
    }

    this.kernel =
      kernel ??
      new ReActKernel({
        model: model ?? failMissingTaskAgentModel(),
        interpreter: interpreter ?? new TaskEffectInterpreter(),
      });
    this.taskTools = taskTools;
    this.maxRounds = maxRounds;
  }

  /**
   * 一直跑直到某次工具调用返回的 `effects` 数组里包含 `TerminateEffect`。
   * Interpreter 把它翻译成 `TaskAgentControl.stop`，kernel 透传到
   * `roundResult.control`，本方法读出后退出循环并用 `control.content` 作为
   * `buildResult` 的入参。跑满 maxRounds 仍无 terminate 则抛
   * `TaskAgentMaxRoundsExceededError`。
   */
  public async invoke(input: TInput): Promise<TOutput> {
    const invocation = await this.createInvocation(input);
    const messages = [...invocation.messages];

    for (let round = 0; round < this.maxRounds; round += 1) {
      const roundResult = await this.kernel.runRound({
        state: {
          systemPrompt: invocation.systemPrompt,
          messages: [...messages],
        },
        tools: this.taskTools,
        toolContext: invocation.toolContext,
        usage: invocation.usage,
      });
      if (roundResult.shouldCommit) {
        messages.push(roundResult.assistantMessage, ...roundResult.appendedMessages);
      }

      if (roundResult.control?.kind === "stop") {
        return await this.buildResult({
          input,
          messages,
          content: roundResult.control.content,
        });
      }
    }

    throw new TaskAgentMaxRoundsExceededError(this.maxRounds);
  }

  protected abstract createInvocation(input: TInput): Promise<TaskAgentInvocationState<TUsage>>;

  protected abstract buildResult(input: {
    input: TInput;
    messages: LlmMessage[];
    content: string;
  }): Promise<TOutput> | TOutput;
}

function failMissingTaskAgentModel(): never {
  throw new Error("BaseTaskAgent requires model when kernel is not provided");
}
