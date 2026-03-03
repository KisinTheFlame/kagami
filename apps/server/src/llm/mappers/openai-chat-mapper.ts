import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmFinishReason,
  LlmMessage,
  LlmProviderId,
  LlmTool,
  LlmToolCall,
  LlmToolChoice,
  LlmUsage,
} from "../types.js";
import { LlmProviderResponseError } from "../errors.js";

export function toOpenAiChatRequest(
  request: LlmChatRequest,
  model: string,
): ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    messages: mapMessagesToOpenAi(request.messages),
    tools: mapToolsToOpenAi(request.tools),
    tool_choice: mapToolChoiceToOpenAi(request.toolChoice),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
  };
}

export function toLlmChatResponse(
  provider: LlmProviderId,
  fallbackModel: string,
  completion: ChatCompletion,
): LlmChatResponse {
  const choice = completion.choices[0];
  const message = choice?.message;

  if (!message) {
    throw new LlmProviderResponseError(provider, "Provider response contained no assistant message");
  }

  return {
    provider,
    model: completion.model ?? fallbackModel,
    message: {
      role: "assistant",
      content: message.content ?? "",
      toolCalls: mapToolCallsFromOpenAi(message.tool_calls),
    },
    finishReason: mapFinishReason(choice?.finish_reason),
    usage: mapUsage(completion),
    raw: completion,
  };
}

function mapMessagesToOpenAi(messages: LlmMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content.length > 0 ? message.content : undefined,
        tool_calls: mapToolCallsToOpenAi(message.toolCalls),
      };
    }

    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    return message;
  });
}

function mapToolsToOpenAi(tools: LlmTool[] | undefined): ChatCompletionTool[] | undefined {
  return tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function mapToolChoiceToOpenAi(
  toolChoice: LlmToolChoice | undefined,
): ChatCompletionToolChoiceOption | undefined {
  if (!toolChoice || toolChoice === "auto" || toolChoice === "none") {
    return toolChoice;
  }

  return {
    type: "function",
    function: {
      name: toolChoice.name,
    },
  };
}

function mapToolCallsToOpenAi(toolCalls: LlmToolCall[] | undefined): ChatCompletionMessageToolCall[] | undefined {
  return toolCalls?.map((toolCall) => ({
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments,
    },
  }));
}

function mapToolCallsFromOpenAi(
  toolCalls: ChatCompletionMessageToolCall[] | undefined,
): LlmToolCall[] | undefined {
  const functionToolCalls =
    toolCalls
      ?.filter((toolCall): toolCall is Extract<ChatCompletionMessageToolCall, { type: "function" }> => {
        return toolCall.type === "function";
      })
      .map((toolCall) => ({
        id: toolCall.id,
        type: "function" as const,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      })) ?? [];

  return functionToolCalls.length > 0 ? functionToolCalls : undefined;
}

function mapFinishReason(finishReason: string | null | undefined): LlmFinishReason {
  switch (finishReason) {
    case "stop":
    case "tool_calls":
    case "length":
    case "content_filter":
      return finishReason;
    case "function_call":
      return "tool_calls";
    default:
      return "unknown";
  }
}

function mapUsage(completion: ChatCompletion): LlmUsage | undefined {
  if (!completion.usage) {
    return undefined;
  }

  return {
    promptTokens: completion.usage.prompt_tokens,
    completionTokens: completion.usage.completion_tokens,
    totalTokens: completion.usage.total_tokens,
  };
}
