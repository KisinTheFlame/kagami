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
  LlmChatResponsePayload,
  LlmContentPart,
} from "../types.js";
import { BizError } from "../../common/errors/biz-error.js";
import type { Config } from "../../config/config.loader.js";
import { AppLogger } from "../../logger/logger.js";
import { ClaudeCodeAuthStore } from "./claude-code-auth.js";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_BETA = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "effort-2025-11-24",
].join(",");
const CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.76 (external, sdk-cli)";
const CLAUDE_CODE_SDK_PROMPT = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const CLAUDE_CODE_BILLING_HEADER =
  "x-anthropic-billing-header: cc_version=2.1.76.b57; cc_entrypoint=sdk-cli; cch=00000;";
const DEFAULT_MAX_TOKENS = 4096;
const CLAUDE_4_MAX_TOKENS = 32000;
const CLAUDE_4_THINKING_BUDGET = 1024;
const KEEP_ALIVE_REPLAY_MAX_TOKENS = 1;
const logger = new AppLogger({ source: "claude-code-provider" });

type LlmProviderConfig = Config["server"]["llm"]["providers"]["claudeCode"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

type ClaudeSystemBlock = {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
    ttl?: "1h";
  };
};

type ClaudeMessageRequestBody = {
  model: string;
  max_tokens: number;
  stream: true;
  cache_control?: {
    type: "ephemeral";
    ttl?: "1h";
  };
  system: ClaudeSystemBlock[];
  messages: Array<{
    role: "user" | "assistant";
    content: Array<Record<string, unknown>>;
  }>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown>;
  thinking?: Record<string, unknown>;
  output_config?: Record<string, unknown>;
  context_management?: Record<string, unknown>;
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
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
};

export function createClaudeCodeProvider(input: {
  config: LlmProviderConfig;
  authStore: ClaudeCodeAuthStore;
}): LlmProvider {
  let replayTimeout: NodeJS.Timeout | null = null;
  let lastSuccessfulRequestBody: ClaudeMessageRequestBody | null = null;
  let lastSuccessfulRequestVersion = 0;
  let isReplaying = false;
  let isClosed = false;

  function clearReplayTimeout(): void {
    if (!replayTimeout) {
      return;
    }

    clearTimeout(replayTimeout);
    replayTimeout = null;
  }

  function scheduleReplay(version: number): void {
    clearReplayTimeout();

    if (isClosed || !lastSuccessfulRequestBody) {
      return;
    }

    replayTimeout = setTimeout(() => {
      replayTimeout = null;
      void replayLastSuccessfulRequest(version);
    }, input.config.keepAliveReplayIntervalMinutes * 60_000);

    if (typeof replayTimeout.unref === "function") {
      replayTimeout.unref();
    }
  }

  async function replayLastSuccessfulRequest(version: number): Promise<void> {
    if (isClosed || version !== lastSuccessfulRequestVersion || !lastSuccessfulRequestBody) {
      return;
    }

    if (isReplaying) {
      scheduleReplay(version);
      return;
    }

    isReplaying = true;
    try {
      const replayRequestBody = structuredClone(lastSuccessfulRequestBody);
      replayRequestBody.max_tokens = KEEP_ALIVE_REPLAY_MAX_TOKENS;
      await sendClaudeCodeRequest({
        config: input.config,
        authStore: input.authStore,
        requestBody: replayRequestBody,
      });
    } catch (error) {
      logReplayFailure(error);
    } finally {
      isReplaying = false;
    }

    if (!isClosed && version === lastSuccessfulRequestVersion && lastSuccessfulRequestBody) {
      scheduleReplay(version);
    }
  }

  return {
    id: "claude-code",
    isAvailable: async () => {
      return await input.authStore.hasCredentials();
    },
    async chat(request: LlmChatRequest): Promise<LlmProviderChatResult> {
      try {
        const requestBody = toClaudeCodeRequestBody(request);
        const result = await sendClaudeCodeRequest({
          config: input.config,
          authStore: input.authStore,
          requestBody,
        });
        lastSuccessfulRequestBody = structuredClone(requestBody);
        lastSuccessfulRequestVersion += 1;
        scheduleReplay(lastSuccessfulRequestVersion);
        return result;
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
    close(): void {
      isClosed = true;
      clearReplayTimeout();
    },
  };
}

async function sendClaudeCodeRequest(params: {
  config: LlmProviderConfig;
  authStore: ClaudeCodeAuthStore;
  requestBody: ClaudeMessageRequestBody;
}): Promise<LlmProviderChatResult> {
  const initialAuth = await params.authStore.getAuth();
  const initialResponse = await fetchClaudeCodeResponse({
    config: params.config,
    auth: initialAuth,
    requestBody: params.requestBody,
  });

  if (initialResponse.status !== 401 && initialResponse.status !== 403) {
    return mapClaudeMessageResult({
      requestBody: params.requestBody,
      responsePayload: initialResponse.responsePayload,
    });
  }

  throw attachLlmProviderFailureContext(
    new BizError({
      message: "所选 LLM provider 当前不可用",
      meta: {
        provider: "claude-code",
        reason: "UNAUTHORIZED",
      },
    }),
    {
      nativeRequestPayload: toSerializableLlmNativeRecord(params.requestBody),
      nativeResponsePayload: toSerializableLlmNativeRecordOrNull(initialResponse.responsePayload),
      nativeError: buildClaudeCodeNativeError({
        status: initialResponse.status,
        responseText: initialResponse.responseText,
        reason: "UNAUTHORIZED",
      }),
    },
  );
}

async function fetchClaudeCodeResponse(params: {
  config: LlmProviderConfig;
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
    response = await fetch(`${baseUrl}/v1/messages?beta=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.auth.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Anthropic-Version": ANTHROPIC_VERSION,
        "Anthropic-Beta": ANTHROPIC_BETA,
        "Anthropic-Dangerous-Direct-Browser-Access": "true",
        "User-Agent": CLAUDE_CODE_USER_AGENT,
        "X-App": "cli",
        "X-Stainless-Retry-Count": "0",
        "X-Stainless-Runtime-Version": process.version,
        "X-Stainless-Package-Version": "0.74.0",
        "X-Stainless-Runtime": "node",
        "X-Stainless-Lang": "js",
        "X-Stainless-Arch": toClaudeCodeRuntimeArch(),
        "X-Stainless-OS": toClaudeCodeRuntimeOs(),
        "X-Stainless-Timeout": String(Math.max(1, Math.trunc(params.config.timeoutMs / 1000))),
        Connection: "keep-alive",
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
  const responsePayload = parseClaudeMessageResponse(responseText);

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
  const thinkingConfig = toClaudeThinkingConfig({
    model,
    toolChoice: request.toolChoice,
  });

  return {
    model,
    stream: true,
    max_tokens: resolveClaudeMaxTokens(model),
    cache_control: {
      type: "ephemeral",
      ttl: "1h",
    },
    system: toClaudeSystemBlocks(request.system),
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
    ...(thinkingConfig ? thinkingConfig : {}),
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

function toClaudeSystemBlocks(system: string | undefined): ClaudeSystemBlock[] {
  const blocks: ClaudeSystemBlock[] = [
    {
      type: "text",
      text: CLAUDE_CODE_BILLING_HEADER,
    },
    {
      type: "text",
      text: CLAUDE_CODE_SDK_PROMPT,
    },
  ];

  if (system) {
    blocks.push({
      type: "text",
      text: system,
    });
  }

  return blocks;
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

function toClaudeThinkingConfig(input: {
  model: string;
  toolChoice: LlmChatRequest["toolChoice"];
}): Record<string, unknown> | null {
  if (forcesToolUse(input.toolChoice)) {
    return {
      thinking: {
        type: "disabled",
      },
    };
  }

  if (isClaudeAdaptiveModel(input.model)) {
    return {
      thinking: {
        type: "adaptive",
      },
      output_config: {
        effort: "medium",
      },
      context_management: {
        edits: [
          {
            type: "clear_thinking_20251015",
            keep: "all",
          },
        ],
      },
    };
  }

  if (isClaude4Model(input.model)) {
    return {
      thinking: {
        type: "enabled",
        budget_tokens: CLAUDE_4_THINKING_BUDGET,
      },
    };
  }

  return null;
}

function resolveClaudeMaxTokens(model: string): number {
  if (isClaude4Model(model)) {
    return CLAUDE_4_MAX_TOKENS;
  }

  return DEFAULT_MAX_TOKENS;
}

function isClaudeAdaptiveModel(model: string): boolean {
  return model.startsWith("claude-sonnet-4-6") || model.startsWith("claude-opus-4-6");
}

function isClaude4Model(model: string): boolean {
  return model.startsWith("claude-sonnet-4-") || model.startsWith("claude-opus-4-");
}

function forcesToolUse(toolChoice: LlmChatRequest["toolChoice"]): boolean {
  return (
    toolChoice === "required" || (isRecord(toolChoice) && typeof toolChoice.tool_name === "string")
  );
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
  const usage = input.responsePayload.usage ? toLlmUsage(input.responsePayload.usage) : undefined;
  return {
    response: {
      provider: "claude-code",
      model: input.responsePayload.model ?? input.requestBody.model,
      message,
      ...(usage ? { usage } : {}),
    },
    nativeRequestPayload: toSerializableLlmNativeRecord(input.requestBody),
    nativeResponsePayload: toSerializableLlmNativeRecord(input.responsePayload),
  };
}

function toLlmUsage(
  usage: NonNullable<ClaudeMessageResponse["usage"]>,
): LlmProviderChatResult["response"]["usage"] {
  const cacheHitTokens = usage.cache_read_input_tokens;
  const cacheCreationTokens = usage.cache_creation_input_tokens;
  const uncachedPromptTokens = usage.input_tokens;
  const promptTokens = [cacheHitTokens, cacheCreationTokens, uncachedPromptTokens].reduce<number>(
    (sum, value) => sum + (typeof value === "number" ? value : 0),
    0,
  );
  const cacheMissTokens =
    (typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0) +
    (typeof uncachedPromptTokens === "number" ? uncachedPromptTokens : 0);
  const completionTokens = usage.output_tokens;

  return {
    ...(promptTokens > 0 ? { promptTokens } : {}),
    ...(typeof completionTokens === "number" ? { completionTokens } : {}),
    ...(promptTokens > 0 || typeof completionTokens === "number"
      ? { totalTokens: promptTokens + (completionTokens ?? 0) }
      : {}),
    ...(typeof cacheHitTokens === "number" ? { cacheHitTokens } : {}),
    ...(cacheMissTokens > 0 ? { cacheMissTokens } : {}),
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

function logReplayFailure(error: unknown): void {
  try {
    logger.warn("Failed to replay Claude Code keep-alive request", {
      event: "llm.claude_code.keep_alive_replay_failed",
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // Ignore logging failures in contexts where logger runtime is not initialized.
  }
}

function parseClaudeMessageResponse(value: string): ClaudeMessageResponse | null {
  const parsedStream = parseClaudeStreamResponse(value);
  if (parsedStream) {
    return parsedStream;
  }

  try {
    return JSON.parse(value) as ClaudeMessageResponse;
  } catch {
    return null;
  }
}

function parseClaudeStreamResponse(value: string): ClaudeMessageResponse | null {
  if (!value.startsWith("event:")) {
    return null;
  }

  const streamBlocks: Array<
    | { kind: "ignored" }
    | { kind: "text"; block: { type: "text"; text: string } }
    | {
        kind: "tool_use";
        block: { type: "tool_use"; id?: string; name?: string; input?: Record<string, unknown> };
        partialJson: string;
      }
  > = [];
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cacheReadInputTokens: number | undefined;
  let cacheCreationInputTokens: number | undefined;

  for (const chunk of value.split("\n\n")) {
    const lines = chunk
      .split("\n")
      .map(line => line.trimEnd())
      .filter(line => line.length > 0);
    if (lines.length === 0) {
      continue;
    }

    const dataLine = lines.find(line => line.startsWith("data:"));
    if (!dataLine) {
      continue;
    }

    const dataJson = dataLine.slice("data:".length).trim();
    if (!dataJson.startsWith("{")) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataJson) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type === "message_start") {
      const message = isRecord(parsed.message) ? parsed.message : null;
      if (message && typeof message.model === "string") {
        model = message.model;
      }
      const usage = message && isRecord(message.usage) ? message.usage : null;
      if (usage && typeof usage.input_tokens === "number") {
        inputTokens = usage.input_tokens;
      }
      if (usage && typeof usage.output_tokens === "number") {
        outputTokens = usage.output_tokens;
      }
      if (usage && typeof usage.cache_read_input_tokens === "number") {
        cacheReadInputTokens = usage.cache_read_input_tokens;
      }
      if (usage && typeof usage.cache_creation_input_tokens === "number") {
        cacheCreationInputTokens = usage.cache_creation_input_tokens;
      }
      continue;
    }

    if (parsed.type === "content_block_start") {
      const index = typeof parsed.index === "number" ? parsed.index : -1;
      const contentBlock = isRecord(parsed.content_block) ? parsed.content_block : null;
      if (index < 0 || !contentBlock) {
        continue;
      }

      if (contentBlock.type === "text") {
        streamBlocks[index] = {
          kind: "text",
          block: {
            type: "text",
            text: typeof contentBlock.text === "string" ? contentBlock.text : "",
          },
        };
        continue;
      }

      if (contentBlock.type === "tool_use") {
        streamBlocks[index] = {
          kind: "tool_use",
          block: {
            type: "tool_use",
            ...(typeof contentBlock.id === "string" ? { id: contentBlock.id } : {}),
            ...(typeof contentBlock.name === "string" ? { name: contentBlock.name } : {}),
            ...(isRecord(contentBlock.input) ? { input: contentBlock.input } : {}),
          },
          partialJson: "",
        };
        continue;
      }

      streamBlocks[index] = { kind: "ignored" };
      continue;
    }

    if (parsed.type === "content_block_delta") {
      const index = typeof parsed.index === "number" ? parsed.index : -1;
      const streamBlock = index >= 0 ? streamBlocks[index] : undefined;
      const delta = isRecord(parsed.delta) ? parsed.delta : null;
      if (!streamBlock || !delta) {
        continue;
      }

      if (streamBlock.kind === "text" && delta.type === "text_delta") {
        streamBlock.block.text += typeof delta.text === "string" ? delta.text : "";
        continue;
      }

      if (streamBlock.kind === "tool_use" && delta.type === "input_json_delta") {
        streamBlock.partialJson += typeof delta.partial_json === "string" ? delta.partial_json : "";
      }
      continue;
    }

    if (parsed.type === "content_block_stop") {
      const index = typeof parsed.index === "number" ? parsed.index : -1;
      const streamBlock = index >= 0 ? streamBlocks[index] : undefined;
      if (!streamBlock || streamBlock.kind !== "tool_use" || streamBlock.partialJson.length === 0) {
        continue;
      }

      try {
        const parsedInput = JSON.parse(streamBlock.partialJson) as unknown;
        if (isRecord(parsedInput)) {
          streamBlock.block.input = parsedInput;
        }
      } catch {
        streamBlock.block.input = {};
      }
      continue;
    }

    if (parsed.type === "message_delta") {
      const usage = isRecord(parsed.usage) ? parsed.usage : null;
      if (usage && typeof usage.input_tokens === "number") {
        inputTokens = usage.input_tokens;
      }
      if (usage && typeof usage.output_tokens === "number") {
        outputTokens = usage.output_tokens;
      }
      if (usage && typeof usage.cache_read_input_tokens === "number") {
        cacheReadInputTokens = usage.cache_read_input_tokens;
      }
      if (usage && typeof usage.cache_creation_input_tokens === "number") {
        cacheCreationInputTokens = usage.cache_creation_input_tokens;
      }
    }
  }

  const content = streamBlocks.flatMap(block => {
    if (!block || block.kind === "ignored") {
      return [];
    }

    return [block.block];
  });

  if (content.length === 0) {
    return null;
  }

  return {
    type: "message",
    role: "assistant",
    ...(model ? { model } : {}),
    content,
    ...(inputTokens !== undefined ||
    outputTokens !== undefined ||
    cacheReadInputTokens !== undefined ||
    cacheCreationInputTokens !== undefined
      ? {
          usage: {
            ...(inputTokens !== undefined ? { input_tokens: inputTokens } : {}),
            ...(outputTokens !== undefined ? { output_tokens: outputTokens } : {}),
            ...(cacheReadInputTokens !== undefined
              ? { cache_read_input_tokens: cacheReadInputTokens }
              : {}),
            ...(cacheCreationInputTokens !== undefined
              ? { cache_creation_input_tokens: cacheCreationInputTokens }
              : {}),
          },
        }
      : {}),
  };
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

function toClaudeCodeRuntimeArch(): string {
  return process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
}

function toClaudeCodeRuntimeOs(): string {
  switch (process.platform) {
    case "darwin":
      return "MacOS";
    case "linux":
      return "Linux";
    case "win32":
      return "Windows";
    default:
      return process.platform;
  }
}
