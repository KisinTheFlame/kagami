import type { TaskAgent } from "./agent-runtime.js";
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

/**
 * 判定一次 tool call 是否标志任务完成。
 *
 * 旧版本只能比 toolCall.name（顶层工具名）；新版本下子工具可能埋在 args 里
 * （比如 invoke({tool: "finalize_web_search"}) 这种 dispatcher 形态），需要让
 * task agent 自己定义匹配规则。返回 true 即终止 invoke 循环、走 buildResult。
 */
export type TaskAgentTerminalPredicate = (toolCall: ReActToolCall) => boolean;

export abstract class BaseTaskAgent<
  TInput,
  TOutput,
  TMessage extends { role: string },
  TUsage extends string = string,
> implements TaskAgent<TInput, TOutput> {
  private readonly kernel: ReActKernel<TMessage, TUsage>;
  private readonly taskTools: ToolExecutor<TMessage>;
  private readonly terminalToolPredicate: TaskAgentTerminalPredicate;

  public constructor({
    kernel,
    model,
    taskTools,
    terminalToolPredicate,
  }: {
    kernel?: ReActKernel<TMessage, TUsage>;
    model?: TaskAgentModel<TMessage, TUsage>;
    taskTools: ToolExecutor<TMessage>;
    terminalToolPredicate: TaskAgentTerminalPredicate;
  }) {
    this.kernel = kernel ?? new ReActKernel({ model: model ?? failMissingTaskAgentModel() });
    this.taskTools = taskTools;
    this.terminalToolPredicate = terminalToolPredicate;
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

      // Check if any of the executed tool calls is a terminal tool.
      // The first terminal hit provides the result content for buildResult.
      const terminalExecution = roundResult.toolExecutions.find(execution =>
        this.terminalToolPredicate(execution.toolCall),
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
