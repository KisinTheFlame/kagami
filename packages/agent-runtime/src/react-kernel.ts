import type { ToolExecutor, ToolSetExecutionResult } from "./tool/tool-catalog.js";
import type { ToolContext, ToolDefinition } from "./tool/tool-component.js";

export type ReActToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AssistantLikeMessage = {
  role: "assistant";
  content: string;
  toolCalls: ReActToolCall[];
};

export type ToolLikeMessage = {
  role: "tool";
  toolCallId: string;
  content: string;
};

export interface ReActModel<
  TMessage extends { role: string },
  TUsage extends string = string,
  TCompletion extends {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  } = {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
> {
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
  ): Promise<TCompletion>;
}

export type ReActRoundState<TMessage> = {
  systemPrompt?: string;
  messages: TMessage[];
};

export type ReActKernelRunRoundInput<TMessage extends { role: string }, TUsage extends string> = {
  state: ReActRoundState<TMessage>;
  tools: ToolExecutor<TMessage>;
  toolContext?: ToolContext<TMessage>;
  usage: TUsage;
};

export type ReActToolExecution<TMessage extends { role: string }, TExtensionData = unknown> = {
  toolCall: ReActToolCall;
  result: ToolSetExecutionResult;
  appendedMessages: Array<Extract<TMessage, { role: "tool" }>>;
  extensionData?: TExtensionData;
};

export type ReActRoundResult<
  TMessage extends { role: string },
  TCompletion extends {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
  TExtensionData = unknown,
> = {
  completion: TCompletion;
  assistantMessage: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  toolExecutions: ReActToolExecution<TMessage, TExtensionData>[];
  appendedMessages: TMessage[];
  shouldCommit: boolean;
};

export type ReActKernelModelErrorDecision = {
  handled: boolean;
  retry: boolean;
};

export type ReActKernelToolErrorDecision = {
  handled: boolean;
  result?: ToolSetExecutionResult;
};

export interface ReActKernelExtension<
  TMessage extends { role: string },
  TUsage extends string,
  TCompletion extends {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
  TExtensionData = unknown,
> {
  onBeforeModel?(input: ReActKernelRunRoundInput<TMessage, TUsage>): Promise<void> | void;
  onAfterModel?(input: {
    request: ReActKernelRunRoundInput<TMessage, TUsage>;
    completion: TCompletion;
  }): Promise<void> | void;
  onModelError?(input: {
    request: ReActKernelRunRoundInput<TMessage, TUsage>;
    error: unknown;
  }): Promise<ReActKernelModelErrorDecision | void> | ReActKernelModelErrorDecision | void;
  onBeforeToolExecution?(input: {
    request: ReActKernelRunRoundInput<TMessage, TUsage>;
    completion: TCompletion;
    toolCall: ReActToolCall;
  }): Promise<void> | void;
  onToolError?(input: {
    request: ReActKernelRunRoundInput<TMessage, TUsage>;
    completion: TCompletion;
    toolCall: ReActToolCall;
    error: unknown;
  }): Promise<ReActKernelToolErrorDecision | void> | ReActKernelToolErrorDecision | void;
  onAfterToolExecution?(input: {
    request: ReActKernelRunRoundInput<TMessage, TUsage>;
    completion: TCompletion;
    toolCall: ReActToolCall;
    result: ToolSetExecutionResult;
  }):
    | Promise<{
        appendedMessages?: TMessage[];
        extensionData?: TExtensionData;
      } | void>
    | {
        appendedMessages?: TMessage[];
        extensionData?: TExtensionData;
      }
    | void;
}

export class ReActKernel<
  TMessage extends { role: string },
  TUsage extends string = string,
  TCompletion extends {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  } = {
    message: Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage;
  },
  TExtensionData = unknown,
> {
  private readonly model: ReActModel<TMessage, TUsage, TCompletion>;
  private readonly extensions: ReActKernelExtension<
    TMessage,
    TUsage,
    TCompletion,
    TExtensionData
  >[];

  public constructor({
    model,
    extensions,
  }: {
    model: ReActModel<TMessage, TUsage, TCompletion>;
    extensions?: ReActKernelExtension<TMessage, TUsage, TCompletion, TExtensionData>[];
  }) {
    this.model = model;
    this.extensions = extensions ?? [];
  }

  public async runRound(
    request: ReActKernelRunRoundInput<TMessage, TUsage>,
  ): Promise<ReActRoundResult<TMessage, TCompletion, TExtensionData>> {
    for (const extension of this.extensions) {
      await extension.onBeforeModel?.(request);
    }

    let completion: TCompletion;
    try {
      completion = await this.model.chat(
        {
          system: request.state.systemPrompt,
          messages: [...request.state.messages],
          tools: request.tools.definitions(),
          toolChoice: "required",
        },
        {
          usage: request.usage,
        },
      );
    } catch (error) {
      for (const extension of this.extensions) {
        const decision = await extension.onModelError?.({
          request,
          error,
        });
        if (decision?.handled) {
          return {
            completion: {
              message: {
                role: "assistant",
                content: "",
                toolCalls: [],
              },
            } as unknown as TCompletion,
            assistantMessage: {
              role: "assistant",
              content: "",
              toolCalls: [],
            } as unknown as Extract<TMessage, { role: "assistant" }> & AssistantLikeMessage,
            toolExecutions: [],
            appendedMessages: [],
            shouldCommit: false,
          };
        }
      }

      throw error;
    }

    for (const extension of this.extensions) {
      await extension.onAfterModel?.({
        request,
        completion,
      });
    }

    const appendedMessages: TMessage[] = [];
    const toolExecutions: ReActToolExecution<TMessage, TExtensionData>[] = [];
    const toolContext = request.toolContext ?? {};
    const assistantMessage = completion.message;
    const toolContextMessages = [...request.state.messages];

    for (const toolCall of assistantMessage.toolCalls) {
      for (const extension of this.extensions) {
        await extension.onBeforeToolExecution?.({
          request,
          completion,
          toolCall,
        });
      }

      let result: ToolSetExecutionResult;
      try {
        result = await request.tools.execute(toolCall.name, toolCall.arguments, {
          ...toolContext,
          messages: [...toolContextMessages],
          ...(request.state.systemPrompt !== undefined
            ? {
                systemPrompt: request.state.systemPrompt,
              }
            : {}),
        });
      } catch (error) {
        const fallback = await this.resolveToolError({
          request,
          completion,
          toolCall,
          error,
        });
        if (!fallback) {
          throw error;
        }

        result = fallback;
      }

      const toolMessages: Array<Extract<TMessage, { role: "tool" }>> =
        result.content.length > 0
          ? [
              {
                role: "tool",
                toolCallId: toolCall.id,
                content: result.content,
              } as unknown as Extract<TMessage, { role: "tool" }>,
            ]
          : [];

      let extensionData: TExtensionData | undefined;
      const extraMessages: TMessage[] = [];
      for (const extension of this.extensions) {
        const augmentation = await extension.onAfterToolExecution?.({
          request,
          completion,
          toolCall,
          result,
        });
        if (!augmentation) {
          continue;
        }

        if (augmentation.appendedMessages && augmentation.appendedMessages.length > 0) {
          extraMessages.push(...augmentation.appendedMessages);
        }

        if (augmentation.extensionData !== undefined) {
          extensionData = augmentation.extensionData;
        }
      }

      const combinedMessages = [...toolMessages, ...extraMessages];
      appendedMessages.push(...combinedMessages);
      toolContextMessages.push(...extraMessages);
      toolExecutions.push({
        toolCall,
        result,
        appendedMessages: toolMessages,
        ...(extensionData !== undefined ? { extensionData } : {}),
      });
    }

    return {
      completion,
      assistantMessage,
      toolExecutions,
      appendedMessages,
      shouldCommit: true,
    };
  }

  private async resolveToolError(input: {
    request: ReActKernelRunRoundInput<TMessage, TUsage>;
    completion: TCompletion;
    toolCall: ReActToolCall;
    error: unknown;
  }): Promise<ToolSetExecutionResult | null> {
    for (const extension of this.extensions) {
      const decision = await extension.onToolError?.(input);
      if (decision?.handled) {
        return decision.result ?? null;
      }
    }

    return null;
  }
}
