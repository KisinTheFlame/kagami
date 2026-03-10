import type { LlmProvider } from "../provider.js";
import type { LlmChatRequest, LlmChatResponsePayload, LlmToolCall } from "../types.js";
import type { OpenAiCodexRuntimeConfig } from "../../config/config.manager.js";
import {
  LlmProviderResponseError,
  LlmProviderUnavailableError,
  LlmProviderUpstreamError,
} from "../errors.js";
import {
  OpenAiCodexAuthRefreshError,
  OpenAiCodexAuthStore,
  OpenAiCodexAuthUnavailableError,
} from "./openai-codex-auth.js";

const DEFAULT_INSTRUCTIONS = "You are a helpful assistant.";

type CodexResponseCompletedEvent = {
  type: "response.completed";
  response?: {
    model?: string;
    status?: string;
    error?: { message?: string } | null;
    output?: Array<{
      id?: string;
      type?: string;
      name?: string;
      call_id?: string;
      arguments?: string;
      role?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
};

export function createOpenAiCodexProvider(config: OpenAiCodexRuntimeConfig): LlmProvider {
  const authStore = new OpenAiCodexAuthStore(config);

  return {
    id: "openai-codex",
    isAvailable: async () => {
      return await authStore.hasCredentials();
    },
    async chat(request: LlmChatRequest): Promise<LlmChatResponsePayload> {
      try {
        return await sendCodexRequest({
          config,
          authStore,
          request,
        });
      } catch (error) {
        if (error instanceof LlmProviderUnavailableError) {
          throw error;
        }

        if (error instanceof LlmProviderResponseError) {
          throw error;
        }

        if (error instanceof OpenAiCodexAuthUnavailableError) {
          throw new LlmProviderUnavailableError({ provider: "openai-codex" });
        }

        if (error instanceof OpenAiCodexAuthRefreshError) {
          if (error.status === 400 || error.status === 401 || error.status === 403) {
            throw new LlmProviderUnavailableError({ provider: "openai-codex" });
          }

          throw new LlmProviderUpstreamError({
            provider: "openai-codex",
            message: error.message,
            cause: error,
          });
        }

        throw new LlmProviderUpstreamError({
          provider: "openai-codex",
          message: error instanceof Error ? error.message : "OpenAI Codex 请求失败",
          cause: error,
        });
      }
    },
  };
}

async function sendCodexRequest(params: {
  config: OpenAiCodexRuntimeConfig;
  authStore: OpenAiCodexAuthStore;
  request: LlmChatRequest;
}): Promise<LlmChatResponsePayload> {
  const initialAuth = await params.authStore.getAuth();
  const initialResponse = await fetchCodexResponse({
    config: params.config,
    auth: initialAuth,
    request: params.request,
  });

  if (initialResponse.status !== 401 && initialResponse.status !== 403) {
    return mapCompletedEvent(initialResponse.completedEvent);
  }

  const refreshedAuth = await params.authStore.getAuth({ forceRefresh: true });
  const retriedResponse = await fetchCodexResponse({
    config: params.config,
    auth: refreshedAuth,
    request: params.request,
  });

  if (retriedResponse.status === 401 || retriedResponse.status === 403) {
    throw new LlmProviderUnavailableError({ provider: "openai-codex" });
  }

  return mapCompletedEvent(retriedResponse.completedEvent);
}

async function fetchCodexResponse(params: {
  config: OpenAiCodexRuntimeConfig;
  auth: Awaited<ReturnType<OpenAiCodexAuthStore["getAuth"]>>;
  request: LlmChatRequest;
}): Promise<{ status: number; completedEvent: CodexResponseCompletedEvent }> {
  let response: Response;
  try {
    response = await fetch(params.config.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.auth.accessToken}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...(params.auth.accountId ? { "ChatGPT-Account-Id": params.auth.accountId } : {}),
        "User-Agent": "Kagami/1.0",
      },
      body: JSON.stringify(toCodexRequestBody(params.request, params.config.chatModel)),
      signal: AbortSignal.timeout(params.config.timeoutMs),
    });
  } catch (error) {
    throw new LlmProviderUpstreamError({
      provider: "openai-codex",
      message: error instanceof Error ? error.message : "OpenAI Codex 请求失败",
      cause: error,
    });
  }

  const sseText = await response.text();
  const completedEvent = extractCompletedEvent(sseText);
  if (!completedEvent) {
    if (response.status === 401 || response.status === 403) {
      return {
        status: response.status,
        completedEvent: {
          type: "response.completed",
          response: {
            status: "failed",
            error: {
              message: sseText.slice(0, 500),
            },
          },
        },
      };
    }

    throw new LlmProviderResponseError({
      provider: "openai-codex",
      message: `OpenAI Codex 返回了无法解析的响应（HTTP ${response.status}）`,
    });
  }

  if (response.status === 401 || response.status === 403) {
    return { status: response.status, completedEvent };
  }

  if (!response.ok) {
    throw new LlmProviderUpstreamError({
      provider: "openai-codex",
      message:
        completedEvent.response?.error?.message ??
        `OpenAI Codex 返回异常状态码（HTTP ${response.status}）`,
    });
  }

  return { status: response.status, completedEvent };
}

function toCodexRequestBody(
  request: LlmChatRequest,
  defaultModel: string,
): Record<string, unknown> {
  const input: Array<Record<string, unknown>> = [];

  for (const message of request.messages) {
    if (message.role === "user") {
      input.push({
        role: "user",
        content: message.content,
      });
      continue;
    }

    if (message.role === "assistant") {
      if (message.content.length > 0) {
        input.push({
          role: "assistant",
          content: message.content,
        });
      }

      for (const toolCall of message.toolCalls) {
        input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        });
      }

      continue;
    }

    input.push({
      type: "function_call_output",
      call_id: message.toolCallId,
      output: message.content,
    });
  }

  return {
    model: request.model ?? defaultModel,
    instructions: request.system ?? DEFAULT_INSTRUCTIONS,
    input,
    tools: request.tools.map(tool => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    tool_choice:
      request.toolChoice === "auto" ||
      request.toolChoice === "none" ||
      request.toolChoice === "required"
        ? request.toolChoice
        : {
            type: "function",
            name: request.toolChoice.tool_name,
          },
    stream: true,
    store: false,
  };
}

function extractCompletedEvent(sseText: string): CodexResponseCompletedEvent | null {
  const blocks = sseText
    .split("\n\n")
    .map(block => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find(line => line.startsWith("event: "));
    const dataLines = lines.filter(line => line.startsWith("data: "));
    if (!eventLine || dataLines.length === 0) {
      continue;
    }

    if (eventLine.slice("event: ".length) !== "response.completed") {
      continue;
    }

    const payload = safeParseJson<CodexResponseCompletedEvent>(
      dataLines.map(line => line.slice("data: ".length)).join("\n"),
    );
    if (payload?.type === "response.completed") {
      return payload;
    }
  }

  return null;
}

function mapCompletedEvent(event: CodexResponseCompletedEvent): LlmChatResponsePayload {
  const response = event.response;
  if (!response) {
    throw new LlmProviderResponseError({
      provider: "openai-codex",
      message: "OpenAI Codex 响应缺少 response 字段",
    });
  }

  const toolCalls: LlmToolCall[] = [];
  let content = "";

  for (const item of response.output ?? []) {
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id ?? item.id ?? "",
        name: item.name ?? "",
        arguments: parseToolArguments(item.arguments),
      });
      continue;
    }

    if (item.type === "message" && item.role === "assistant") {
      content += (item.content ?? [])
        .filter(part => part.type === "output_text")
        .map(part => part.text ?? "")
        .join("");
    }
  }

  if (toolCalls.some(toolCall => toolCall.id.length === 0 || toolCall.name.length === 0)) {
    throw new LlmProviderResponseError({
      provider: "openai-codex",
      message: "OpenAI Codex 返回了不完整的 tool call",
    });
  }

  if (content.length === 0 && toolCalls.length === 0) {
    throw new LlmProviderResponseError({
      provider: "openai-codex",
      message: "OpenAI Codex 响应中没有 assistant 内容或 tool call",
    });
  }

  return {
    provider: "openai-codex",
    model: response.model ?? "",
    message: {
      role: "assistant",
      content,
      toolCalls,
    },
    usage: response.usage
      ? {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

function parseToolArguments(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  const parsed = safeParseJson<Record<string, unknown>>(value);
  if (!parsed) {
    throw new LlmProviderResponseError({
      provider: "openai-codex",
      message: "OpenAI Codex tool call arguments 不是合法 JSON",
    });
  }

  return parsed;
}

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
