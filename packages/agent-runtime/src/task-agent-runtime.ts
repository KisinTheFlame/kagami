import type { AgentRuntime } from "./agent-runtime.js";
import type { ToolExecutor } from "./tool/tool-catalog.js";
import type { ToolContext, ToolDefinition } from "./tool/tool-component.js";

export type TaskAgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AssistantLikeMessage = {
  role: "assistant";
  content: string;
  toolCalls: TaskAgentToolCall[];
};

export type ToolLikeMessage = {
  role: "tool";
  toolCallId: string;
  content: string;
};

export interface TaskAgentModel<TMessage extends { role: string }, TUsage extends string = string> {
  chat(
    request: {
      system?: string;
      messages: TMessage[];
      tools: ToolDefinition[];
      toolChoice: "required";
    },
    options: {
      usage: TUsage;
    },
  ): Promise<{
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  }>;
}

export type TaskAgentInvoker<TInput, TOutput> = Pick<AgentRuntime<TInput, TOutput>, "invoke">;

export type TaskAgentInvocationState<TMessage extends { role: string }, TUsage extends string> = {
  systemPrompt?: string;
  messages: TMessage[];
  toolContext?: ToolContext<TMessage>;
  usage: TUsage;
};

export abstract class TaskAgentRuntime<
  TInput,
  TOutput,
  TMessage extends { role: string },
  TUsage extends string = string,
> implements AgentRuntime<TInput, TOutput> {
  private readonly model: TaskAgentModel<TMessage, TUsage>;
  private readonly taskTools: ToolExecutor<TMessage>;

  public constructor({
    model,
    taskTools,
  }: {
    model: TaskAgentModel<TMessage, TUsage>;
    taskTools: ToolExecutor<TMessage>;
  }) {
    this.model = model;
    this.taskTools = taskTools;
  }

  public async invoke(input: TInput): Promise<TOutput> {
    const invocation = await this.createInvocation(input);
    const messages = [...invocation.messages];

    while (true) {
      const response = await this.model.chat(
        {
          system: invocation.systemPrompt,
          messages: [...messages],
          tools: this.taskTools.definitions(),
          toolChoice: "required",
        },
        {
          usage: invocation.usage,
        },
      );

      messages.push(response.message);

      for (const toolCall of response.message.toolCalls) {
        const executionResult = await this.taskTools.execute(
          toolCall.name,
          toolCall.arguments,
          invocation.toolContext ?? {},
        );

        if (executionResult.content.length > 0) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: executionResult.content,
          } as unknown as Extract<TMessage, { role: "tool" }>);
        }

        if (executionResult.signal === "finish_round") {
          return await this.buildResult({
            input,
            messages,
            content: executionResult.content,
          });
        }
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
