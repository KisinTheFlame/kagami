import type {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type {
  LlmContentPart,
  LlmChatRequest,
  LlmChatResponsePayload,
  LlmMessage,
  LlmToolCall,
  LlmUsage,
} from "../types.js";
import type { LlmProviderId } from "../../common/contracts/llm.js";

type OpenAiStyleUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};

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
      messages.push({
        role: "user",
        content:
          typeof msg.content === "string" ? msg.content : msg.content.map(toOpenAiUserContentPart),
      });
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
    request.toolChoice === "auto" ||
    request.toolChoice === "none" ||
    request.toolChoice === "required"
      ? request.toolChoice
      : { type: "function" as const, function: { name: request.toolChoice.tool_name } };

  return {
    model,
    messages,
    ...(tools && { tools, tool_choice: toolChoice }),
  };
}

function toOpenAiUserContentPart(part: LlmContentPart): ChatCompletionContentPart {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
    };
  }

  return {
    type: "image_url",
    image_url: {
      url: `data:${part.mimeType};base64,${part.content.toString("base64")}`,
    },
  };
}

export function toLlmChatResponsePayload(
  completion: ChatCompletion,
  provider: LlmProviderId,
): LlmChatResponsePayload {
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
    usage: completion.usage ? toLlmUsage(completion.usage as OpenAiStyleUsage) : undefined,
  };
}

function toLlmUsage(usage: OpenAiStyleUsage): LlmUsage {
  const promptTokens = usage.prompt_tokens;
  const cacheHitTokens =
    usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? undefined;
  const cacheMissTokens =
    usage.prompt_cache_miss_tokens ??
    (typeof promptTokens === "number" && typeof cacheHitTokens === "number"
      ? Math.max(promptTokens - cacheHitTokens, 0)
      : undefined);

  return {
    promptTokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
    ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
  };
}
