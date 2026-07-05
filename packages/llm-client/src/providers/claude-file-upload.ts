import { createHash } from "node:crypto";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { LlmChatRequest, LlmImageContentPart } from "../types.js";
import type { ClaudeFileCacheDao } from "./claude-file-cache.dao.js";
import { ANTHROPIC_VERSION, CLAUDE_CODE_USER_AGENT } from "./claude-code-constants.js";

/**
 * claude-code 图片 File API 预解析：把请求里所有图片（user-role content part）先换成
 * 已上传的 Anthropic file_id，避免每轮把 base64 塞进 /v1/messages 请求体撑爆 ~32MB 上限。
 *
 * - 缓存命中（sha256 → file_id）直接用；未命中 POST /v1/files 上传一次再写缓存。
 * - 单张失败（网络 / 401/403 scope 缺失）→ 不写入返回 map → 上层 builder 回退 base64 内联，
 *   请求仍成功。整批 best-effort、并发上传。
 * - 依赖 OAuth scope 含 user:file_upload + Anthropic-Beta 含 files-api-2025-04-14。
 */

const logger = new AppLogger({ source: "claude-code-file-upload" });

type ClaudeFileUploadResponse = {
  id?: string;
};

/** 收集请求里所有唯一图片（按裸 base64 content 去重），逐张解析成 file_id。返回 content→fileId。 */
export async function resolveClaudeImageFileIds(params: {
  request: LlmChatRequest;
  fileCacheDao: ClaudeFileCacheDao;
  baseUrl: string;
  anthropicBeta: string;
  // 惰性取 token：仅在真正需要上传（缓存未命中）时才解析 OAuth token，且整批只解析一次。
  // 纯文本轮 / 全部命中缓存的轮次完全不触发 getAuth，热路径零额外开销。
  getAccessToken: () => Promise<string>;
  timeoutMs: number;
}): Promise<Map<string, string>> {
  const uniqueImages = collectUniqueImageParts(params.request);
  const resolved = new Map<string, string>();
  if (uniqueImages.size === 0) {
    return resolved;
  }

  let tokenPromise: Promise<string> | null = null;
  const getAccessToken = (): Promise<string> => (tokenPromise ??= params.getAccessToken());

  await Promise.all(
    [...uniqueImages.values()].map(async part => {
      const fileId = await resolveSingleImage({
        part,
        fileCacheDao: params.fileCacheDao,
        baseUrl: params.baseUrl,
        anthropicBeta: params.anthropicBeta,
        getAccessToken,
        timeoutMs: params.timeoutMs,
      });
      if (fileId !== null) {
        resolved.set(part.content, fileId);
      }
    }),
  );

  return resolved;
}

function collectUniqueImageParts(request: LlmChatRequest): Map<string, LlmImageContentPart> {
  const uniqueImages = new Map<string, LlmImageContentPart>();
  for (const message of request.messages) {
    if (message.role !== "user" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "image") {
        // key 用裸 base64 content：同一张图 content 相同 → 去重；builder 也按 content 查表。
        uniqueImages.set(part.content, part);
      }
    }
  }
  return uniqueImages;
}

async function resolveSingleImage(params: {
  part: LlmImageContentPart;
  fileCacheDao: ClaudeFileCacheDao;
  baseUrl: string;
  anthropicBeta: string;
  getAccessToken: () => Promise<string>;
  timeoutMs: number;
}): Promise<string | null> {
  try {
    const bytes = Buffer.from(params.part.content, "base64");

    // 0 字节图（空 base64 / 被 JSON 毒成 {type:"Buffer",data:[]} 的历史坏图）：绝不上传，
    // 否则会把一个空文件的 file_id 永久写进缓存（Files API 文件不过期），后续该内容永远引用坏文件。
    // 返回 null → builder 回退 base64（与引入 File API 前对坏图的处理一致）。
    if (bytes.byteLength === 0) {
      return null;
    }

    const contentSha256 = createHash("sha256").update(bytes).digest("hex");

    const cached = await params.fileCacheDao.findByHash(contentSha256);
    if (cached) {
      return cached.fileId;
    }

    const fileId = await uploadClaudeFile({
      bytes,
      mimeType: params.part.mimeType,
      filename: params.part.filename,
      baseUrl: params.baseUrl,
      anthropicBeta: params.anthropicBeta,
      accessToken: await params.getAccessToken(),
      timeoutMs: params.timeoutMs,
    });

    await params.fileCacheDao.save({
      contentSha256,
      fileId,
      mimeType: params.part.mimeType,
      sizeBytes: bytes.byteLength,
    });

    return fileId;
  } catch (error) {
    logUploadFailure(error);
    return null;
  }
}

async function uploadClaudeFile(params: {
  bytes: Buffer;
  mimeType: string;
  filename?: string;
  baseUrl: string;
  anthropicBeta: string;
  accessToken: string;
  timeoutMs: number;
}): Promise<string> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  const form = new FormData();
  // 拷进新的 Uint8Array（底层是纯 ArrayBuffer，非 SharedArrayBuffer）：Node 的 Buffer 类型
  // 是 ArrayBufferLike-backed，直接喂 Blob 会被 TS 判为不满足 BlobPart。图片只上传一次，
  // 一次拷贝成本可忽略。
  const view = Uint8Array.from(params.bytes);
  const blob = new Blob([view], { type: params.mimeType });
  form.append("file", blob, params.filename ?? "image");

  const response = await fetch(`${baseUrl}/v1/files`, {
    method: "POST",
    headers: {
      // 不设 Content-Type：FormData 由 fetch 自动带 multipart boundary。
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      "Anthropic-Version": ANTHROPIC_VERSION,
      "Anthropic-Beta": params.anthropicBeta,
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "User-Agent": CLAUDE_CODE_USER_AGENT,
      "X-App": "cli",
    },
    body: form,
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`Claude Files API upload failed: HTTP ${response.status}`), {
      status: response.status,
      responseText: text.slice(0, 500),
    });
  }

  const payload = (await response.json()) as ClaudeFileUploadResponse;
  if (!payload?.id) {
    throw new Error("Claude Files API upload returned no file id");
  }
  return payload.id;
}

function logUploadFailure(error: unknown): void {
  const status =
    error !== null && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  const scopeHint =
    status === 401 || status === 403
      ? "（可能 OAuth 缺 user:file_upload scope，需在 console 重新登录 claude-code）"
      : "";
  try {
    logger.warn(`Claude 图片上传失败，该图回退 base64 内联${scopeHint}`, {
      event: "llm.claude_code.file_upload_failed",
      status: typeof status === "number" ? status : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // logger runtime 未初始化的上下文里忽略日志失败。
  }
}
