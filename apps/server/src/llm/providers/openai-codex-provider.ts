import type { LlmProvider } from "../provider.js";
import type { LlmChatRequest, LlmChatResponsePayload, LlmToolCall } from "../types.js";
import { BizError } from "../../errors/biz-error.js";
import type { OpenAiCodexRuntimeConfig } from "../../config/config.manager.js";
import { OpenAiCodexAuthStore } from "./openai-codex-auth.js";

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
        if (error instanceof BizError) {
          throw error;
        }

        throw new BizError({
          message: "LLM 上游服务调用失败",
          meta: {
            provider: "openai-codex",
          },
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
    throw new BizError({
      message: "所选 LLM provider 当前不可用",
      meta: {
        provider: "openai-codex",
        reason: "UNAUTHORIZED",
      },
    });
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
      body: JSON.stringify(toCodexRequestBody(params.request)),
      signal: AbortSignal.timeout(params.config.timeoutMs),
    });
  } catch (error) {
    throw new BizError({
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai-codex",
      },
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

    throw new BizError({
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai-codex",
        reason: "INVALID_SSE_RESPONSE",
        status: response.status,
      },
    });
  }

  if (response.status === 401 || response.status === 403) {
    return { status: response.status, completedEvent };
  }

  if (!response.ok) {
    throw new BizError({
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai-codex",
        reason: "HTTP_ERROR",
        status: response.status,
      },
    });
  }

  return { status: response.status, completedEvent };
}

function toCodexRequestBody(request: LlmChatRequest): Record<string, unknown> {
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
    model: requireRequestModel(request),
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

function requireRequestModel(request: LlmChatRequest): string {
  if (!request.model) {
    throw new Error("OpenAI Codex provider requires an explicit model");
  }

  return request.model;
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
    throw new BizError({
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai-codex",
        reason: "MISSING_RESPONSE",
      },
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
    throw new BizError({
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai-codex",
        reason: "INVALID_TOOL_CALL",
      },
    });
  }

  if (content.length === 0 && toolCalls.length === 0) {
    throw new BizError({
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai-codex",
        reason: "EMPTY_ASSISTANT_OUTPUT",
      },
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
    throw new BizError({
      message: "LLM 上游服务调用失败",
      meta: {
        provider: "openai-codex",
        reason: "INVALID_TOOL_ARGUMENTS",
      },
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
