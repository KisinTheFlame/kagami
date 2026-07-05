import {
  attachLlmProviderFailureContext,
  toSerializableLlmNativeRecord,
  toSerializableLlmNativeRecordOrNull,
  type LlmProvider,
  type LlmProviderChatResult,
} from "../provider.js";
import type { LlmChatRequest } from "../types.js";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { Config } from "@kagami/kernel/config/config.loader";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { ClaudeCodeAuthProvider } from "./claude-code-auth.js";
import { toClaudeCodeRequestBody } from "./claude-code-request.js";
import { mapClaudeMessageResult, parseClaudeMessageResponse } from "./claude-code-response.js";
import type { ClaudeMessageRequestBody, ClaudeMessageResponse } from "./claude-code-wire.js";
import type { ClaudeFileCacheDao } from "./claude-file-cache.dao.js";
import { resolveClaudeImageFileIds } from "./claude-file-upload.js";
import { ANTHROPIC_VERSION, CLAUDE_CODE_USER_AGENT } from "./claude-code-constants.js";

/**
 * Claude Code provider 装配层：HTTP 发送 / 鉴权头 / keep-alive replay / 错误上下文。
 * 请求构造在 claude-code-request.ts，响应（含 SSE 流重组）解析在 claude-code-response.ts，
 * wire 类型在 claude-code-wire.ts——原 932 行单文件按此缝拆开，公共入口不变。
 */

const ANTHROPIC_BETA = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "effort-2025-11-24",
  // 图片走 Files API（上传 /v1/files + 消息里 source:{type:"file"} 引用两处都吃这个 beta）。
  // 依赖 OAuth scope 含 user:file_upload——见 packages/auth/src/claude-code/oauth.ts。
  "files-api-2025-04-14",
].join(",");
const KEEP_ALIVE_REPLAY_MAX_TOKENS = 1;
const logger = new AppLogger({ source: "claude-code-provider" });

type LlmProviderConfig = Config["server"]["llm"]["providers"]["claudeCode"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

export function createClaudeCodeProvider(input: {
  config: LlmProviderConfig;
  authStore: ClaudeCodeAuthProvider;
  // 图片 File API 缓存（sha256→file_id 持久化）。缺省 / config.useFileApi=false 时全走 base64，
  // 与引入 File API 前逐字节一致（回滚只需翻 config，无需回滚代码）。
  fileCacheDao?: ClaudeFileCacheDao;
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
        // File API 预解析：图片先换 file_id，请求体不再随 base64 膨胀撞 ~32MB 上限。
        // 关闭 / 无缓存 DAO 时 imageFileIds 为 undefined → builder 全走 base64（旧行为）。
        const imageFileIds =
          input.config.useFileApi && input.fileCacheDao
            ? await resolveClaudeImageFileIds({
                request,
                fileCacheDao: input.fileCacheDao,
                baseUrl: input.config.baseUrl,
                anthropicBeta: ANTHROPIC_BETA,
                getAccessToken: async () => (await input.authStore.getAuth()).accessToken,
                timeoutMs: input.config.timeoutMs,
              })
            : undefined;
        const requestBody = toClaudeCodeRequestBody(request, imageFileIds);
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
  authStore: ClaudeCodeAuthProvider;
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
  auth: Awaited<ReturnType<ClaudeCodeAuthProvider["getAuth"]>>;
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
