import type { TaskAgent } from "./agent-runtime.js";
import type { Effect } from "./effect.js";
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

function isTerminateEffect(effect: Effect): boolean {
  return effect.type === TERMINATE_EFFECT_TYPE;
}

export abstract class BaseTaskAgent<
  TInput,
  TOutput,
  TMessage extends { role: string },
  TUsage extends string = string,
> implements TaskAgent<TInput, TOutput> {
  private readonly kernel: ReActKernel<TMessage, TUsage>;
  private readonly taskTools: ToolExecutor<TMessage>;

  public constructor({
    kernel,
    model,
    taskTools,
  }: {
    kernel?: ReActKernel<TMessage, TUsage>;
    model?: TaskAgentModel<TMessage, TUsage>;
    taskTools: ToolExecutor<TMessage>;
  }) {
    this.kernel = kernel ?? new ReActKernel({ model: model ?? failMissingTaskAgentModel() });
    this.taskTools = taskTools;
  }

  /**
   * 一直跑直到某次工具调用返回的 `effects` 数组里包含 `{ type: "terminate" }`。
   * 该终止工具的 content 字符串作为 buildResult 的入参。
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

      // 找第一个产 terminate Effect 的 tool execution。它的 content 是
      // buildResult 的入参（通常是 task 的最终输出 summary）。
      const terminalExecution = roundResult.toolExecutions.find(execution =>
        (execution.result.effects ?? []).some(isTerminateEffect),
      );
      if (terminalExecution) {
        return await this.buildResult({
          input,
          messages,
          content: terminalExecution.result.content,
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
