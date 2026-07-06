import {
  attachLlmProviderFailureContext,
  toSerializableLlmNativeRecord,
  toSerializableLlmNativeRecordOrNull,
} from "../../provider.js";
import { llmProviderUnavailableError, llmUpstreamCallFailedError } from "../../retryable-error.js";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { OpenAiCodexAuthProvider } from "../../providers/openai-codex-auth.js";
import type { ImageProvider } from "../provider.js";
import type { ImageGenerationRequest, ImageGenerationResult } from "../types.js";

/**
 * openai-codex 生图 provider。复用 chat 侧 openai-codex provider 同一套 OAuth 认证 + endpoint
 * （`chatgpt.com/backend-api/codex/responses`）+ SSE，走 ChatGPT 订阅额度，无需 platform API key。
 *
 * 与 chat provider 的关键分歧：图片不在 `response.completed`（store:false 时其 output 为空数组），
 * 而在流式的 `response.output_item.done`（item.type=image_generation_call 的 item.result）里 —— 故
 * 生图不能复用 chat provider 的 completed-only 解析，必须走本文件的流式累积。
 *
 * 强制出图用 `tool_choice: { type: allowed_tools, mode: required }`（直接 `{type:image_generation}`
 * 强制会被后端 400，allowed_tools 包装形式才生效），保证每轮必出图。tool 内显式 model=gpt-image-2。
 *
 * 实测确证（含照搬同类项目 xiaoni_cc 的完整请求形状复现）：codex 后端**忽略 size**，固定回
 * 1254×1254，连竖版请求都被拉成正方形。size/quality 如实透传只为对齐未来标准-API provider。
 */
type OpenAiCodexImageProviderConfig = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

/** 出图后端模型（放进 image_generation tool 的 model 字段；顶层 request.model 是 responses 路由模型）。 */
const IMAGE_BACKEND_MODEL = "gpt-image-2";

const IMAGE_INSTRUCTIONS =
  "Use the image_generation tool to create exactly the requested image. Return the image result, not explanatory text.";

type CodexImagePayload = {
  b64: string;
  revisedPrompt?: string;
  size?: string;
  outputFormat?: string;
};

export function createOpenAiCodexImageProvider(input: {
  config: OpenAiCodexImageProviderConfig;
  authStore: OpenAiCodexAuthProvider;
}): ImageProvider {
  return {
    id: "openai-codex",
    isAvailable: async () => {
      return await input.authStore.hasCredentials();
    },
    async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
      try {
        return await sendCodexImageRequest({
          config: input.config,
          authStore: input.authStore,
          request,
        });
      } catch (error) {
        if (error instanceof BizError) {
          throw error;
        }

        throw attachLlmProviderFailureContext(
          llmUpstreamCallFailedError({
            meta: { provider: "openai-codex", capability: "image" },
            cause: error,
          }),
          { nativeError: toSerializableLlmNativeRecord(error) },
        );
      }
    },
  };
}

async function sendCodexImageRequest(params: {
  config: OpenAiCodexImageProviderConfig;
  authStore: OpenAiCodexAuthProvider;
  request: ImageGenerationRequest;
}): Promise<ImageGenerationResult> {
  const model = params.request.model ?? params.config.model;
  const requestBody = toCodexImageRequestBody({ ...params.request, model });

  const initialAuth = await params.authStore.getAuth();
  let result = await fetchCodexImage({
    config: params.config,
    accessToken: initialAuth.accessToken,
    accountId: initialAuth.accountId,
    requestBody,
  });

  if (result.status === 401 || result.status === 403) {
    const refreshedAuth = await params.authStore.getAuth({ forceRefresh: true });
    result = await fetchCodexImage({
      config: params.config,
      accessToken: refreshedAuth.accessToken,
      accountId: refreshedAuth.accountId,
      requestBody,
    });

    if (result.status === 401 || result.status === 403) {
      throw attachLlmProviderFailureContext(
        llmProviderUnavailableError({
          meta: { provider: "openai-codex", capability: "image", reason: "UNAUTHORIZED" },
        }),
        {
          nativeRequestPayload: toSerializableLlmNativeRecord(requestBody),
          nativeError: buildCodexNativeError({
            status: result.status,
            responseText: result.sseText,
            reason: "UNAUTHORIZED",
          }),
        },
      );
    }
  }

  if (!result.ok) {
    throw attachLlmProviderFailureContext(
      llmUpstreamCallFailedError({
        meta: {
          provider: "openai-codex",
          capability: "image",
          reason: "HTTP_ERROR",
          status: result.status,
        },
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(requestBody),
        nativeError: buildCodexNativeError({
          status: result.status,
          responseText: result.sseText,
          reason: "HTTP_ERROR",
        }),
      },
    );
  }

  const upstreamError = extractCodexUpstreamError(result.sseText);
  if (upstreamError) {
    throw attachLlmProviderFailureContext(
      llmUpstreamCallFailedError({
        meta: { provider: "openai-codex", capability: "image", reason: "UPSTREAM_ERROR" },
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(requestBody),
        nativeError: buildCodexNativeError({
          status: result.status,
          responseText: upstreamError,
          reason: "UPSTREAM_ERROR",
        }),
      },
    );
  }

  const payload = extractCodexImageFromSse(result.sseText);
  if (!payload) {
    throw attachLlmProviderFailureContext(
      llmUpstreamCallFailedError({
        meta: { provider: "openai-codex", capability: "image", reason: "NO_IMAGE_OUTPUT" },
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(requestBody),
        nativeResponsePayload: toSerializableLlmNativeRecordOrNull(
          buildCodexNativeError({
            status: result.status,
            responseText: result.sseText,
            reason: "NO_IMAGE_OUTPUT",
          }),
        ),
      },
    );
  }

  return {
    provider: "openai-codex",
    model,
    image: {
      data: Buffer.from(payload.b64, "base64"),
      mimeType: `image/${payload.outputFormat ?? "png"}`,
    },
    ...(payload.revisedPrompt ? { revisedPrompt: payload.revisedPrompt } : {}),
    ...(payload.size ? { size: payload.size } : {}),
  };
}

async function fetchCodexImage(params: {
  config: OpenAiCodexImageProviderConfig;
  accessToken: string;
  accountId?: string;
  requestBody: Record<string, unknown>;
}): Promise<{ status: number; ok: boolean; sseText: string }> {
  let response: Response;
  try {
    response = await fetch(params.config.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...(params.accountId ? { "ChatGPT-Account-Id": params.accountId } : {}),
        "User-Agent": "Kagami/1.0",
      },
      body: JSON.stringify(params.requestBody),
      signal: AbortSignal.timeout(params.config.timeoutMs),
    });
  } catch (error) {
    throw attachLlmProviderFailureContext(
      llmUpstreamCallFailedError({
        meta: { provider: "openai-codex", capability: "image" },
        cause: error,
      }),
      {
        nativeRequestPayload: toSerializableLlmNativeRecord(params.requestBody),
        nativeError: toSerializableLlmNativeRecord(error),
      },
    );
  }

  const sseText = await response.text();
  return { status: response.status, ok: response.ok, sseText };
}

export function toCodexImageRequestBody(request: ImageGenerationRequest): Record<string, unknown> {
  // tool 内 model 显式指定出图后端模型（顶层 request.model 是 responses 路由模型 gpt-5.x）。
  // size/quality 如实透传，但 codex 后端固定回 1254×1254、忽略尺寸——留着为对齐未来的标准-API
  // provider（那条才认 size），并防后端某天开始支持（实测确证见文件头注释）。
  const imageTool: Record<string, unknown> = {
    type: "image_generation",
    model: IMAGE_BACKEND_MODEL,
    output_format: "png",
  };
  if (request.size) {
    imageTool.size = request.size;
  }
  if (request.quality) {
    imageTool.quality = request.quality;
  }

  return {
    model: request.model,
    instructions: IMAGE_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: request.prompt }],
      },
    ],
    tools: [imageTool],
    // allowed_tools + mode:required 是能生效的强制写法——直接 { type: "image_generation" } 强制会被
    // 后端 400，而这个包装形式保证每轮必调工具、不会偶尔回纯文本。
    tool_choice: {
      type: "allowed_tools",
      mode: "required",
      tools: [{ type: "image_generation" }],
    },
    parallel_tool_calls: true,
    stream: true,
    store: false,
  };
}

type CodexSseEvent = {
  event: string;
  data: Record<string, unknown> | null;
};

function* iterateCodexSseEvents(sseText: string): Generator<CodexSseEvent> {
  const blocks = sseText
    .split("\n\n")
    .map(block => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find(line => line.startsWith("event: "));
    const dataStr = lines
      .filter(line => line.startsWith("data: "))
      .map(line => line.slice("data: ".length))
      .join("\n");
    if (!eventLine || dataStr.length === 0) {
      continue;
    }

    yield { event: eventLine.slice("event: ".length), data: safeParseJson(dataStr) };
  }
}

/**
 * 从 SSE 提取最终图片。优先 `response.output_item.done`（item.type=image_generation_call 的
 * item.result，权威终图），退回最后一个 `partial_image`（default 设置下 partial 即等于终图，
 * 但显式请求 partial_images 时是低清中间帧，故仅作兜底）。导出供单测覆盖解析分支。
 */
export function extractCodexImageFromSse(sseText: string): CodexImagePayload | null {
  let done: CodexImagePayload | null = null;
  let partial: CodexImagePayload | null = null;

  for (const { event, data } of iterateCodexSseEvents(sseText)) {
    if (!data) {
      continue;
    }

    if (event === "response.output_item.done") {
      const item = data.item as Record<string, unknown> | undefined;
      if (item?.type === "image_generation_call" && typeof item.result === "string") {
        done = {
          b64: item.result,
          ...readImageMeta(item),
        };
      }
      continue;
    }

    if (event === "response.image_generation_call.partial_image") {
      if (typeof data.partial_image_b64 === "string") {
        partial = {
          b64: data.partial_image_b64,
          ...readImageMeta(data),
        };
      }
    }
  }

  return done ?? partial;
}

function readImageMeta(source: Record<string, unknown>): Omit<CodexImagePayload, "b64"> {
  const meta: Omit<CodexImagePayload, "b64"> = {};
  if (typeof source.revised_prompt === "string") {
    meta.revisedPrompt = source.revised_prompt;
  }
  if (typeof source.size === "string") {
    meta.size = source.size;
  }
  if (typeof source.output_format === "string") {
    meta.outputFormat = source.output_format;
  }
  return meta;
}

export function extractCodexUpstreamError(sseText: string): string | null {
  for (const { event, data } of iterateCodexSseEvents(sseText)) {
    if (event === "response.completed" && data) {
      const response = data.response as Record<string, unknown> | undefined;
      const error = response?.error as { message?: string } | null | undefined;
      if (error && typeof error.message === "string") {
        return error.message;
      }
    }
  }
  return null;
}

function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildCodexNativeError(input: {
  status: number;
  responseText: string;
  reason: string;
}): Record<string, unknown> {
  return {
    status: input.status,
    reason: input.reason,
    responseText: input.responseText.slice(0, 2_000),
  };
}
