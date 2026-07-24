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
import { imageContentToBase64, type LlmProviderId } from "@kagami/llm";
import { isRecord } from "@kagami/kernel/json/is-record";
import { llmUpstreamCallFailedError } from "../retryable-error.js";

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
      url: `data:${part.mimeType};base64,${imageContentToBase64(part.content)}`,
    },
  };
}

export function toLlmChatResponsePayload(
  completion: ChatCompletion,
  provider: LlmProviderId,
): LlmChatResponsePayload {
  // 调用方（openai-compatible-provider）已在 map 前守过空 choices；这里再守一层做防御，
  // 让 mapper 单独复用时也不会因 choices[0] 解引用崩成未分类 TypeError。
  const openAiMessage = completion.choices[0]?.message;
  if (!openAiMessage) {
    throw llmUpstreamCallFailedError({ meta: { provider, reason: "EMPTY_CHOICES" } });
  }

  const toolCalls: LlmToolCall[] = (openAiMessage.tool_calls ?? [])
    .filter((tc): tc is ChatCompletionMessageFunctionToolCall => tc.type === "function")
    .map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseToolCallArguments(tc.function.arguments, provider),
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

/**
 * 安全解析 OpenAI 风格 tool_call 的 arguments（模型产的 JSON 字符串）。坏 JSON 或非对象
 * （数组 / 标量）都不放行——裸 `JSON.parse` 会抛未分类 SyntaxError、`as Record` 又会让非对象
 * 蒙混进下游工具执行。统一抛可重试的 INVALID_TOOL_ARGUMENTS，模型有机会重生成一版。
 */
function parseToolCallArguments(raw: string, provider: LlmProviderId): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw llmUpstreamCallFailedError({
      meta: { provider, reason: "INVALID_TOOL_ARGUMENTS" },
      cause,
    });
  }
  if (!isRecord(parsed)) {
    throw llmUpstreamCallFailedError({ meta: { provider, reason: "INVALID_TOOL_ARGUMENTS" } });
  }
  return parsed;
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
