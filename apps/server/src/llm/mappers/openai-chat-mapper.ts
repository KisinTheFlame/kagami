import { z } from "zod";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type {
  LlmChatRequest,
  LlmChatResponse,
  LlmMessage,
  LlmProviderId,
  LlmToolCall,
} from "../types.js";

export function toOpenAiChatRequest({
  model,
  request,
}: {
  model: string;
  request: LlmChatRequest;
}): ChatCompletionCreateParamsNonStreaming {
  const messages: ChatCompletionMessageParam[] = [];

  if (request.system) {
    messages.push({ role: "system", content: request.system });
  }

  for (const msg of request.messages) {
    if (msg.role === "user") {
      messages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      messages.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls:
          msg.toolCalls.length > 0
            ? msg.toolCalls.map(tc => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              }))
            : undefined,
      });
    } else {
      messages.push({ role: "tool", tool_call_id: msg.toolCallId, content: msg.content });
    }
  }

  const tools: ChatCompletionTool[] | undefined =
    request.tools.length > 0
      ? request.tools.map(tool => ({
          type: "function" as const,
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }))
      : undefined;

  const toolChoice =
    request.toolChoice === "auto" || request.toolChoice === "none"
      ? request.toolChoice
      : { type: "function" as const, function: { name: request.toolChoice.tool_name } };

  return {
    model,
    messages,
    ...(tools && { tools, tool_choice: toolChoice }),
  };
}

export function toLlmChatResponse(
  completion: ChatCompletion,
  provider: LlmProviderId,
): LlmChatResponse {
  const openAiMessage = completion.choices[0]!.message;

  const toolCalls: LlmToolCall[] = (openAiMessage.tool_calls ?? [])
    .filter((tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === "function")
    .map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

  const message: Extract<LlmMessage, { role: "assistant" }> = {
    role: "assistant",
    content: openAiMessage.content ?? "",
    toolCalls,
  };

  return {
    provider,
    model: completion.model,
    message,
    usage: completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined,
    text() {
      return this.message.content;
    },
    json<S extends z.ZodTypeAny>(schema: S): z.infer<S> {
      return schema.parse(JSON.parse(this.message.content)) as z.infer<S>;
    },
    toolCalls() {
      return this.message.toolCalls;
    },
  };
}
