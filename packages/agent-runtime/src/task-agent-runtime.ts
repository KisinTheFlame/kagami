import type { TaskAgent } from "./agent-runtime.js";
import {
  ReActKernel,
  type AssistantLikeMessage,
  type ReActModel,
  type ToolLikeMessage,
} from "./react-kernel.js";
import type { ToolExecutor } from "./tool/tool-catalog.js";
import type { ToolContext } from "./tool/tool-component.js";

export type TaskAgentToolCall = import("./react-kernel.js").ReActToolCall;
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

      const terminalExecution = roundResult.toolExecutions.find(
        execution => execution.result.signal === "finish_round",
      );
      if (terminalExecution || !roundResult.shouldContinue) {
        return await this.buildResult({
          input,
          messages,
          content: terminalExecution?.result.content ?? "",
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
