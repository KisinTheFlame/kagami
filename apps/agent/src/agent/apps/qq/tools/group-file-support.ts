import { AppLogger } from "@kagami/kernel/logger/logger";
import { BizError } from "@kagami/kernel/errors/biz-error";
import type { NapcatChatTarget } from "../../../../napcat/application/napcat-gateway.service.js";

const logger = new AppLogger({ source: "agent.qq.group-file" });

/** 从错误里取出 BizError.meta.reason（收敛成 string），否则回退 fallback。 */
export function errorReason(error: unknown, fallback: string): string {
  if (error instanceof BizError) {
    const reason = error.meta?.reason;
    if (typeof reason === "string" && reason.length > 0) {
      return reason;
    }
  }
  return fallback;
}

/** 从错误里取一句人读的说明。 */
export function errorNote(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type FetchLike = typeof fetch;

/**
 * 群文件下载字节的硬上限（32 MiB，与图片下载 cap 一致，且压在 OSS 50MB 请求上限下）——
 * 由工具从 config 注入，这里只是 fallback 默认值。
 */
export type ResolveGroupChatResult =
  | { ok: true; groupId: string }
  | { ok: false; error: "NOT_IN_GROUP_CHAT" };

/**
 * 群文件是群能力：只在「当前打开的会话是群」时可用。私聊 / 未开会话 → NOT_IN_GROUP_CHAT。
 */
export function resolveGroupChatId(target: NapcatChatTarget | undefined): ResolveGroupChatResult {
  if (!target || target.chatType !== "group") {
    return { ok: false, error: "NOT_IN_GROUP_CHAT" };
  }
  return { ok: true, groupId: target.groupId };
}

export type DownloadBytesResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: "DOWNLOAD_FAILED" | "FILE_TOO_LARGE" };

/**
 * 从 URL 拉字节，带与 image-message-analyzer 同款护栏：content-length 早拒 + 实际字节兜底 +
 * 非 2xx / 空响应处理 + maxBytes 上限。别裸 `arrayBuffer()`——坏 URL / 大响应会打满内存。
 */
export async function downloadBytesWithCap({
  url,
  maxBytes,
  fetchImpl,
}: {
  url: string;
  maxBytes: number;
  fetchImpl: FetchLike;
}): Promise<DownloadBytesResult> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      logger.warn("Failed to download group file", {
        event: "agent.qq.group_file_download_failed",
        status: response.status,
      });
      return { ok: false, reason: "DOWNLOAD_FAILED" };
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, reason: "FILE_TOO_LARGE" };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      logger.warn("Downloaded group file is empty", {
        event: "agent.qq.group_file_download_empty",
      });
      return { ok: false, reason: "DOWNLOAD_FAILED" };
    }
    if (bytes.byteLength > maxBytes) {
      return { ok: false, reason: "FILE_TOO_LARGE" };
    }
    return { ok: true, bytes };
  } catch (error) {
    logger.errorWithCause("Failed to download group file", error, {
      event: "agent.qq.group_file_download_error",
    });
    return { ok: false, reason: "DOWNLOAD_FAILED" };
  }
}
