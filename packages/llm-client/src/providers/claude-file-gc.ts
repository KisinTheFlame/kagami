import { AppLogger } from "@kagami/kernel/logger/logger";
import type { ClaudeFileCacheDao } from "./claude-file-cache.dao.js";
import {
  ANTHROPIC_VERSION,
  ANTHROPIC_BETA,
  CLAUDE_CODE_USER_AGENT,
} from "./claude-code-constants.js";

/**
 * Claude Files API 缓存的按最近使用时间 GC（#433）。由 kagami-llm 进程的每日 scheduler task 调用：
 * 取 last_used_at 早于 idle cutoff 的行，逐个 DELETE /v1/files/{id} 删远端文件，成功（含 404 已删）
 * 的行再从本地表删除。File API 文件 persist-until-deleted，不清理会只增不减撞组织存储配额。
 *
 * 安全性：base64 原文是 source of truth，删错自愈重传；只删已 idle（不在活上下文）的图，不撞 KV 红线。
 */

const logger = new AppLogger({ source: "claude-code-file-gc" });

const DAY_MS = 86_400_000;

export type ClaudeFileGcMetadata = {
  /** 本轮扫出的候选数（受 maxDeletionsPerRun 截断）。 */
  scanned: number;
  /** 远端 DELETE 返回 2xx 的数量。 */
  deletedRemote: number;
  /** 远端 DELETE 返回 404（已不在）的数量。 */
  alreadyGone: number;
  /** 删前 freshness 复查发现被并发 touch 顶新（又被用了）而跳过的数量。 */
  skippedFresh: number;
  /** 5xx / 网络 / 超时失败（保留本地行，下轮重试）的数量。 */
  failed: number;
  /** 远端已删除但本地行删除失败（残留 stale 行，需下轮或次日 404 路径自愈）的数量。 */
  pruneFailed: number;
  /** 是否因 HTTP 429 提前停止本轮。 */
  rateLimited: boolean;
  /** 从本地表实际删除的行数（= 远端删除成功 + 404 的集合）。 */
  prunedRows: number;
  /** 是否因 scheduler 关停（signal.aborted）提前退出。 */
  aborted: boolean;
};

type DeleteOutcome = "ok" | "gone" | "rate_limited" | "error";

export async function runClaudeFileGc(params: {
  fileCacheDao: ClaudeFileCacheDao;
  getAccessToken: () => Promise<string>;
  baseUrl: string;
  maxIdleDays: number;
  maxDeletionsPerRun: number;
  concurrency: number;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<ClaudeFileGcMetadata> {
  const meta: ClaudeFileGcMetadata = {
    scanned: 0,
    deletedRemote: 0,
    alreadyGone: 0,
    skippedFresh: 0,
    failed: 0,
    pruneFailed: 0,
    rateLimited: false,
    prunedRows: 0,
    aborted: false,
  };
  const cutoff = new Date(Date.now() - params.maxIdleDays * DAY_MS);

  // 整轮惰性解析一次 access token。失败（OAuth 刷新失败等）→ 整轮干净中止，不删任何东西，次日重试。
  let accessToken: string;
  try {
    accessToken = await params.getAccessToken();
  } catch (error) {
    logGcFailure("获取 access token 失败，本轮 GC 中止", error);
    meta.failed = 1;
    return meta;
  }

  const candidates = await params.fileCacheDao.findIdle({
    cutoff,
    limit: params.maxDeletionsPerRun,
  });
  meta.scanned = candidates.length;
  if (candidates.length === 0) {
    return meta;
  }

  let cursor = 0;
  let stop = false; // 429 触发的软停：不再派发新删除

  const worker = async (): Promise<void> => {
    while (!stop && !params.signal.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= candidates.length) {
        return;
      }
      const record = candidates[index];
      if (record === undefined) {
        return;
      }

      // 删前 freshness 复查：候选被选中后、DELETE 前若已被并发 touch 顶到 >= cutoff（又被用了），
      // 跳过不删——关掉"选中 → 删除"窗口内被重新使用的图。残余窗口（复查后、DELETE 落地前被使用）
      // 极窄：该 in-flight 的 LLM 请求可能带着刚被删的 file_id 失败一次，但本地行已删 → 下轮 miss
      // 重传自愈，非持久损坏。
      const fresh = await params.fileCacheDao.findByHash(record.contentSha256);
      if (fresh === null || fresh.lastUsedAt >= cutoff) {
        meta.skippedFresh += 1;
        continue;
      }

      const outcome = await deleteClaudeFile({
        fileId: record.fileId,
        baseUrl: params.baseUrl,
        anthropicBeta: ANTHROPIC_BETA,
        accessToken,
        timeoutMs: params.timeoutMs,
      });
      switch (outcome) {
        case "ok":
          meta.deletedRemote += 1;
          await pruneLocalRow(params.fileCacheDao, record.contentSha256, meta);
          break;
        case "gone":
          meta.alreadyGone += 1;
          await pruneLocalRow(params.fileCacheDao, record.contentSha256, meta);
          break;
        case "rate_limited":
          meta.rateLimited = true;
          stop = true; // 停止本轮，剩余留待次日
          return;
        case "error":
          meta.failed += 1; // 保留本地行，下轮重试（绝不制造孤儿远端文件）
          break;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(params.concurrency, candidates.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  meta.aborted = params.signal.aborted;
  return meta;
}

/**
 * 一致性铁律：远端删成功（含 404）后**立即**删该本地行——留了就是指向死 file_id 的 stale 条目，
 * 后续 findByHash 命中会用坏 id 让请求失败。逐条删（不攒到轮末批量删）把"远端删了但本地没删"的
 * 崩溃/关停暴露面从整轮压到单条。best-effort：本地删失败只 log 计数、不中断整轮（残留的 stale 行
 * 靠下轮/次日 GC 的 404 路径自愈——只要该图保持 idle，会被再次选中、远端 404、本地删掉）。
 */
async function pruneLocalRow(
  fileCacheDao: ClaudeFileCacheDao,
  contentSha256: string,
  meta: ClaudeFileGcMetadata,
): Promise<void> {
  try {
    // 先 await 拿结果再自增：`meta.x += await ...` 是"读-await-写"，并发 worker 会丢更新。
    // 存局部后 `+= n`（读写间无 await）在单线程 event loop 下才原子。
    const deleted = await fileCacheDao.deleteByContentHashes([contentSha256]);
    meta.prunedRows += deleted;
  } catch (error) {
    meta.pruneFailed += 1;
    logGcFailure(`本地缓存行删除失败（远端已删，残留 stale 行待自愈）${contentSha256}`, error);
  }
}

/** DELETE /v1/files/{id}。返回四态：ok（任意 2xx，含 204）/ gone（404）/ rate_limited（429）/ error（其余）。 */
export async function deleteClaudeFile(params: {
  fileId: string;
  baseUrl: string;
  anthropicBeta: string;
  accessToken: string;
  timeoutMs: number;
}): Promise<DeleteOutcome> {
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/files/${params.fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        Accept: "application/json",
        "Anthropic-Version": ANTHROPIC_VERSION,
        "Anthropic-Beta": params.anthropicBeta,
        "Anthropic-Dangerous-Direct-Browser-Access": "true",
        "User-Agent": CLAUDE_CODE_USER_AGENT,
        "X-App": "cli",
      },
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } catch (error) {
    logGcFailure(`删除 Claude file ${params.fileId} 失败（网络/超时）`, error);
    return "error";
  }

  // 始终排空响应体（DELETE 响应很小）：undici 下未消费的 body 会拖住 keep-alive 连接，
  // 单轮最多 maxDeletionsPerRun 次删除会累积泄漏。与 upload / messages 路径的 always-consume 一致。
  const responseText = await response.text().catch(() => "");

  if (response.ok) {
    return "ok"; // 任意 2xx（含 204）
  }
  if (response.status === 404) {
    return "gone";
  }
  if (response.status === 429) {
    return "rate_limited";
  }

  logGcFailure(`删除 Claude file ${params.fileId} 失败：HTTP ${response.status}`, responseText);
  return "error";
}

function logGcFailure(message: string, detail: unknown): void {
  try {
    logger.warn(message, {
      event: "llm.claude_code.file_gc_delete_failed",
      detail: detail instanceof Error ? detail.message : String(detail).slice(0, 500),
    });
  } catch {
    // logger runtime 未初始化的上下文里忽略日志失败。
  }
}
