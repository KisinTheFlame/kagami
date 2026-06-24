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
export type TaskAgentModel<
  TMessage extends { role: string },
  TUsage extends string = string,
> = ReActModel<TMessage, TUsage>;
export type TaskAgentInvoker<TInput, TOutput> = Pick<TaskAgent<TInput, TOutput>, "invoke">;

export type TaskAgentInvocationState<TMessage extends { role: string }, TUsage extends string> = {
  systemPrompt?: string;
  messages: TMessage[];
  toolContext?: ToolContext<TMessage>;
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
export class TerminateHandler<TMessage> implements EffectHandler<TMessage, TaskAgentControl> {
  public matches(effect: Effect): boolean {
    return effect.type === TERMINATE_EFFECT_TYPE;
  }

  public async handle(effect: Effect): Promise<EffectHandlerResult<TMessage, TaskAgentControl>> {
    const terminate = effect as TerminateEffect;
    return { control: { kind: "stop", content: terminate.content } };
  }
}

/**
 * TaskAgent 用的标准 EffectInterpreter。只装一个 `TerminateHandler`——TaskAgent
 * 不像 RootAgent 有切状态 / append message 这些副作用语义，遇到非 terminate 的
 * Effect 由 HandlerEffectInterpreter 抛错。
 */
export class TaskEffectInterpreter<TMessage>
  extends HandlerEffectInterpreter<TMessage, TaskAgentControl>
  implements EffectInterpreter<TMessage, TaskAgentControl>
{
  public constructor() {
    super([new TerminateHandler<TMessage>()]);
  }
}

export abstract class BaseTaskAgent<
  TInput,
  TOutput,
  TMessage extends { role: string },
  TUsage extends string = string,
> implements TaskAgent<TInput, TOutput> {
  private readonly kernel: ReActKernel<
    TMessage,
    TUsage,
    {
      message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
    },
    unknown,
    TaskAgentControl
  >;
  private readonly taskTools: ToolExecutor<TMessage>;

  public constructor({
    kernel,
    model,
    interpreter,
    taskTools,
  }: {
    kernel?: ReActKernel<
      TMessage,
      TUsage,
      {
        message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
      },
      unknown,
      TaskAgentControl
    >;
    model?: TaskAgentModel<TMessage, TUsage>;
    /**
     * 解释 Effect 的 Interpreter。不传则用默认 `TaskEffectInterpreter`——它认识
     * `terminate` Effect 并产 stop control。子类需要识别更多 Effect（罕见）时
     * 自己实现并传入。
     */
    interpreter?: EffectInterpreter<TMessage, TaskAgentControl>;
    taskTools: ToolExecutor<TMessage>;
  }) {
    this.kernel =
      kernel ??
      new ReActKernel({
        model: model ?? failMissingTaskAgentModel(),
        interpreter: interpreter ?? new TaskEffectInterpreter<TMessage>(),
      });
    this.taskTools = taskTools;
  }

  /**
   * 一直跑直到某次工具调用返回的 `effects` 数组里包含 `TerminateEffect`。
   * Interpreter 把它翻译成 `TaskAgentControl.stop`，kernel 透传到
   * `roundResult.control`，本方法读出后退出循环并用 `control.content` 作为
   * `buildResult` 的入参。
   *
   * 设计依据：[docs/effect-model.md](docs/effect-model.md) 场景 2 / 阶段 2。
   */
  public async invoke(input: TInput): Promise<TOutput> {
    const invocation = await this.createInvocation(input);
    const messages = [...invocation.messages];

    while (true) {
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
  }

  protected abstract createInvocation(
    input: TInput,
  ): Promise<TaskAgentInvocationState<TMessage, TUsage>>;

  protected abstract buildResult(input: {
    input: TInput;
    messages: TMessage[];
    content: string;
  }): Promise<TOutput> | TOutput;
}

/**
 * @deprecated Use BaseTaskAgent instead.
 */
export abstract class TaskAgentRuntime<
  TInput,
  TOutput,
  TMessage extends { role: string },
  TUsage extends string = string,
> extends BaseTaskAgent<TInput, TOutput, TMessage, TUsage> {}

function failMissingTaskAgentModel(): never {
  throw new Error("BaseTaskAgent requires model when kernel is not provided");
}
