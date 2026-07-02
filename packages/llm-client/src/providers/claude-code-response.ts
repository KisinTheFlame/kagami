import { BizError } from "@kagami/kernel/errors/biz-error";
import { isRecord } from "@kagami/kernel/json/is-record";
import {
  attachLlmProviderFailureContext,
  toSerializableLlmNativeRecord,
  toSerializableLlmNativeRecordOrNull,
  type LlmProviderChatResult,
} from "../provider.js";
import type { LlmChatResponsePayload } from "../types.js";
import type { ClaudeMessageRequestBody, ClaudeMessageResponse } from "./claude-code-wire.js";

/** 响应文本 → wire 响应：优先按 SSE 流重组，非流则按整块 JSON；都不是返回 null。 */
export function parseClaudeMessageResponse(value: string): ClaudeMessageResponse | null {
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

/** wire 响应 → 统一 LlmProviderChatResult（含 usage 归一与 EMPTY_CONTENT 报错）。 */
export function mapClaudeMessageResult(input: {
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
