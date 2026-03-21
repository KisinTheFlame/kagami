import {
  attachLlmProviderFailureContext,
  toSerializableLlmNativeRecord,
  toSerializableLlmNativeRecordOrNull,
  type LlmProvider,
  type LlmProviderChatResult,
} from "../provider.js";
import type {
  JsonSchema,
  LlmChatRequest,
  LlmContentPart,
  LlmChatResponsePayload,
} from "../types.js";
import { BizError } from "../../errors/biz-error.js";
import type { LlmProviderRuntimeConfig } from "../../config/config.manager.js";
import { ClaudeCodeAuthStore } from "./claude-code-auth.js";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_BETA = "oauth-2025-04-20";
const DEFAULT_MAX_TOKENS = 4096;

type ClaudeMessageRequestBody = {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: Array<Record<string, unknown>>;
  }>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
};

type ClaudeMessageRequest = ClaudeMessageRequestBody["messages"][number];

type ClaudeMessageResponse = {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: Array<
    | {
        type?: "text";
        text?: string;
      }
    | {
        type?: "tool_use";
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }
  >;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
};

export function createClaudeCodeProvider(input: {
  config: LlmProviderRuntimeConfig;
  authStore: ClaudeCodeAuthStore;
}): LlmProvider {
  return {
    id: "claude-code",
    isAvailable: async () => {
      return await input.authStore.hasCredentials();
    },
    async chat(request: LlmChatRequest): Promise<LlmProviderChatResult> {
      try {
        return await sendClaudeCodeRequest({
          config: input.config,
          authStore: input.authStore,
          request,
        });
      } catch (error) {
        if (error instanceof BizError) {
          throw error;
        }

        throw attachLlmProviderFailureContext(
          new BizError({
            message: "LLM 上游服务调用失败",
            meta: {
              provider: "claude-code",
            },
            cause: error,
          }),
          {
            nativeError: toSerializableLlmNativeRecord(error),
          },
        );
      }
    },
  };
}

async function sendClaudeCodeRequest(params: {
  config: LlmProviderRuntimeConfig;
  authStore: ClaudeCodeAuthStore;
  request: LlmChatRequest;
}): Promise<LlmProviderChatResult> {
  const requestBody = toClaudeCodeRequestBody(params.request);
  const initialAuth = await params.authStore.getAuth();
  const initialResponse = await fetchClaudeCodeResponse({
    config: params.config,
    auth: initialAuth,
    requestBody,
  });

  if (initialResponse.status !== 401 && initialResponse.status !== 403) {
    return mapClaudeMessageResult({
      requestBody,
      responsePayload: initialResponse.responsePayload,
    });
  }

  const refreshedAuth = await params.authStore.getAuth({ forceRefresh: true });
  const retriedResponse = await fetchClaudeCodeResponse({
    config: params.config,
    auth: refreshedAuth,
    requestBody,
  });

  if (retriedResponse.status === 401 || retriedResponse.status === 403) {
    throw attachLlmProviderFailureContext(
      new BizError({
        message: "所选 LLM provider 当前不可用",
        meta: {
          provider: "claude-code",
          reason: "UNAUTHORIZED",
        },
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(requestBody),
        nativeResponsePayload: toSerializableLlmNativeRecordOrNull(retriedResponse.responsePayload),
        nativeError: buildClaudeCodeNativeError({
          status: retriedResponse.status,
          responseText: retriedResponse.responseText,
          reason: "UNAUTHORIZED",
        }),
      },
    );
  }

  return mapClaudeMessageResult({
    requestBody,
    responsePayload: retriedResponse.responsePayload,
  });
}

async function fetchClaudeCodeResponse(params: {
  config: LlmProviderRuntimeConfig;
  auth: Awaited<ReturnType<ClaudeCodeAuthStore["getAuth"]>>;
  requestBody: ClaudeMessageRequestBody;
}): Promise<{
  status: number;
  responsePayload: ClaudeMessageResponse | null;
  responseText: string;
}> {
  const baseUrl = params.config.baseUrl.replace(/\/+$/, "");
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.auth.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Anthropic-Version": ANTHROPIC_VERSION,
        "Anthropic-Beta": ANTHROPIC_BETA,
        "Anthropic-Dangerous-Direct-Browser-Access": "true",
        "User-Agent": "claude-cli/2.1.63 (external, cli)",
        "X-App": "cli",
      },
      body: JSON.stringify(params.requestBody),
      signal: AbortSignal.timeout(params.config.timeoutMs),
    });
  } catch (error) {
    throw attachLlmProviderFailureContext(
      new BizError({
        message: "LLM 上游服务调用失败",
        meta: {
          provider: "claude-code",
        },
        cause: error,
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(params.requestBody),
        nativeError: toSerializableLlmNativeRecord(error),
      },
    );
  }

  const responseText = await response.text();
  const responsePayload = safeParseClaudeMessageResponse(responseText);

  if (response.status === 401 || response.status === 403) {
    return {
      status: response.status,
      responsePayload,
      responseText,
    };
  }

  if (!response.ok) {
    throw attachLlmProviderFailureContext(
      new BizError({
        message: "LLM 上游服务调用失败",
        meta: {
          provider: "claude-code",
          reason: "HTTP_ERROR",
          status: response.status,
        },
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(params.requestBody),
        nativeResponsePayload: toSerializableLlmNativeRecordOrNull(responsePayload),
        nativeError: buildClaudeCodeNativeError({
          status: response.status,
          responseText,
          reason: "HTTP_ERROR",
        }),
      },
    );
  }

  if (!responsePayload?.content) {
    throw attachLlmProviderFailureContext(
      new BizError({
        message: "LLM 上游服务调用失败",
        meta: {
          provider: "claude-code",
          reason: "INVALID_RESPONSE",
          status: response.status,
        },
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(params.requestBody),
        nativeResponsePayload: toSerializableLlmNativeRecordOrNull(responsePayload),
        nativeError: buildClaudeCodeNativeError({
          status: response.status,
          responseText,
          reason: "INVALID_RESPONSE",
        }),
      },
    );
  }

  return {
    status: response.status,
    responsePayload,
    responseText,
  };
}

function toClaudeCodeRequestBody(request: LlmChatRequest): ClaudeMessageRequestBody {
  const model = requireRequestModel(request);
  const toolsEnabled = request.tools.length > 0 && request.toolChoice !== "none";
  const toolChoice = toClaudeToolChoice(request.toolChoice);

  return {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    ...(request.system ? { system: request.system } : {}),
    messages: request.messages.flatMap<ClaudeMessageRequest>(message => {
      if (message.role === "user") {
        return [
          {
            role: "user",
            content:
              typeof message.content === "string"
                ? [{ type: "text", text: message.content }]
                : message.content.map(toClaudeUserContentPart),
          },
        ];
      }

      if (message.role === "assistant") {
        const content: Array<Record<string, unknown>> = [];
        if (message.content.length > 0) {
          content.push({
            type: "text",
            text: message.content,
          });
        }
        for (const toolCall of message.toolCalls) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.arguments,
          });
        }

        return content.length > 0
          ? [
              {
                role: "assistant",
                content,
              },
            ]
          : [];
      }

      return [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.toolCallId,
              content: message.content,
            },
          ],
        },
      ];
    }),
    ...(toolsEnabled
      ? {
          tools: request.tools.map(tool => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            input_schema: toInputSchema(tool.parameters),
          })),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
        }
      : {}),
  };
}

function toClaudeUserContentPart(part: LlmContentPart): Record<string, unknown> {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text,
    };
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: part.mimeType,
      data: part.content.toString("base64"),
    },
  };
}

function toInputSchema(parameters: JsonSchema): Record<string, unknown> {
  return {
    type: parameters.type,
    properties: parameters.properties,
  };
}

function toClaudeToolChoice(
  toolChoice: LlmChatRequest["toolChoice"],
): Record<string, unknown> | null {
  if (toolChoice === "auto") {
    return {
      type: "auto",
    };
  }

  if (toolChoice === "required") {
    return {
      type: "any",
    };
  }

  if (toolChoice === "none") {
    return null;
  }

  return {
    type: "tool",
    name: toolChoice.tool_name,
  };
}

function mapClaudeMessageResult(input: {
  requestBody: ClaudeMessageRequestBody;
  responsePayload: ClaudeMessageResponse | null;
}): LlmProviderChatResult {
  if (!input.responsePayload?.content) {
    throw attachLlmProviderFailureContext(
      new BizError({
        message: "LLM 上游服务调用失败",
        meta: {
          provider: "claude-code",
          reason: "EMPTY_CONTENT",
        },
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(input.requestBody),
        nativeResponsePayload: toSerializableLlmNativeRecordOrNull(input.responsePayload),
      },
    );
  }

  const message = toClaudeAssistantMessage(input.responsePayload);
  return {
    response: {
      provider: "claude-code",
      model: input.responsePayload.model ?? input.requestBody.model,
      message,
      ...(input.responsePayload.usage
        ? {
            usage: {
              promptTokens: input.responsePayload.usage.input_tokens,
              completionTokens: input.responsePayload.usage.output_tokens,
              totalTokens:
                (input.responsePayload.usage.input_tokens ?? 0) +
                (input.responsePayload.usage.output_tokens ?? 0),
            },
          }
        : {}),
    },
    nativeRequestPayload: toSerializableLlmNativeRecord(input.requestBody),
    nativeResponsePayload: toSerializableLlmNativeRecord(input.responsePayload),
  };
}

function toClaudeAssistantMessage(
  response: ClaudeMessageResponse,
): LlmChatResponsePayload["message"] {
  const textParts: string[] = [];
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

  for (const block of response.content ?? []) {
    if (block.type === "text" && block.text) {
      textParts.push(block.text);
      continue;
    }

    if (block.type === "tool_use" && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: isRecord(block.input) ? block.input : {},
      });
    }
  }

  return {
    role: "assistant",
    content: textParts.join("\n"),
    toolCalls,
  };
}

function buildClaudeCodeNativeError(input: {
  status: number;
  responseText: string;
  reason: string;
}): Record<string, unknown> {
  return {
    reason: input.reason,
    status: input.status,
    responseText: input.responseText.slice(0, 5000),
  };
}

function safeParseClaudeMessageResponse(value: string): ClaudeMessageResponse | null {
  try {
    return JSON.parse(value) as ClaudeMessageResponse;
  } catch {
    return null;
  }
}

function requireRequestModel(request: { model?: string }): string {
  if (!request.model) {
    throw new Error("Claude Code provider requires an explicit model");
  }

  return request.model;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
