import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { deleteClaudeFile, runClaudeFileGc } from "../src/providers/claude-file-gc.js";
import type {
  ClaudeFileCacheDao,
  ClaudeFileCacheRecord,
} from "../src/providers/claude-file-cache.dao.js";

const BASE_URL = "https://api.anthropic.com";

/** 造一条候选行。lastUsedAt 默认 epoch（远早于任何 cutoff），过 freshness 复查。 */
function record(fileId: string, lastUsedAt: Date = new Date(0)): ClaudeFileCacheRecord {
  return {
    contentSha256: `sha-${fileId}`,
    fileId,
    mimeType: "image/png",
    sizeBytes: 100,
    lastUsedAt,
  };
}

/** mock DAO：findIdle 回给定候选；findByHash 默认回同一条（过复查）；记录 deleteByContentHashes 入参。 */
function createDao(
  candidates: ClaudeFileCacheRecord[],
  overrides: Partial<{ findByHash: Mock }> = {},
): ClaudeFileCacheDao & { findIdle: Mock; deleteByContentHashes: Mock; findByHash: Mock } {
  const byHash = new Map(candidates.map(r => [r.contentSha256, r]));
  const findByHash = overrides.findByHash ?? vi.fn(async (sha: string) => byHash.get(sha) ?? null);
  return {
    findByHash,
    save: vi.fn().mockResolvedValue(undefined),
    touch: vi.fn().mockResolvedValue(undefined),
    findIdle: vi.fn().mockResolvedValue(candidates),
    deleteByContentHashes: vi.fn(async (hashes: readonly string[]) => hashes.length),
  };
}

/** stub 全局 fetch：按 URL 里的 fileId 决定 DELETE 返回码。默认 200。 */
function stubDeleteFetch(statusByFileId: Record<string, number> = {}): Mock {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const s = String(url);
    const fileId = s.slice(s.lastIndexOf("/") + 1);
    const status = statusByFileId[fileId] ?? 200;
    return new Response(null, { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function gcArgs(
  dao: ClaudeFileCacheDao,
  extra: Partial<Parameters<typeof runClaudeFileGc>[0]> = {},
) {
  return {
    fileCacheDao: dao,
    getAccessToken: async () => "token",
    baseUrl: BASE_URL,
    maxIdleDays: 3,
    maxDeletionsPerRun: 2000,
    concurrency: 4,
    timeoutMs: 5_000,
    signal: new AbortController().signal,
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deleteClaudeFile", () => {
  const base = { baseUrl: BASE_URL, anthropicBeta: "beta", accessToken: "token", timeoutMs: 5_000 };

  it("2xx → ok", async () => {
    stubDeleteFetch({ f: 200 });
    expect(await deleteClaudeFile({ fileId: "f", ...base })).toBe("ok");
  });

  it("204 → ok", async () => {
    stubDeleteFetch({ f: 204 });
    expect(await deleteClaudeFile({ fileId: "f", ...base })).toBe("ok");
  });

  it("404 → gone", async () => {
    stubDeleteFetch({ f: 404 });
    expect(await deleteClaudeFile({ fileId: "f", ...base })).toBe("gone");
  });

  it("429 → rate_limited", async () => {
    stubDeleteFetch({ f: 429 });
    expect(await deleteClaudeFile({ fileId: "f", ...base })).toBe("rate_limited");
  });

  it("500 → error", async () => {
    stubDeleteFetch({ f: 500 });
    expect(await deleteClaudeFile({ fileId: "f", ...base })).toBe("error");
  });

  it("网络异常 / 超时 → error（不抛）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await deleteClaudeFile({ fileId: "f", ...base })).toBe("error");
  });

  it("发到 /v1/files/{id} 带鉴权头", async () => {
    const fetchMock = stubDeleteFetch({ f: 200 });
    await deleteClaudeFile({ fileId: "f", ...base });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/files/f`);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });
});

describe("runClaudeFileGc", () => {
  it("空表 → 零 metadata，不发任何 HTTP", async () => {
    const dao = createDao([]);
    const fetchMock = stubDeleteFetch();
    const meta = await runClaudeFileGc(gcArgs(dao));
    expect(meta.scanned).toBe(0);
    expect(meta.prunedRows).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dao.deleteByContentHashes).not.toHaveBeenCalled();
  });

  it("全成功 → 远端删 + 本地逐条删", async () => {
    const dao = createDao([record("a"), record("b")]);
    stubDeleteFetch({ a: 200, b: 200 });
    const meta = await runClaudeFileGc(gcArgs(dao));
    expect(meta.deletedRemote).toBe(2);
    expect(meta.prunedRows).toBe(2);
    // 逐条 prune：每个远端删成功即单独删本地行（崩溃暴露面 = 单条，非整轮）。
    const pruned = dao.deleteByContentHashes.mock.calls.flatMap(c => c[0] as string[]);
    expect(pruned.sort()).toEqual(["sha-a", "sha-b"]);
  });

  it("本地行删除失败 → pruneFailed 计数，不中断整轮（残留 stale 待自愈）", async () => {
    const dao = createDao([record("a"), record("b")]);
    dao.deleteByContentHashes = vi.fn().mockRejectedValue(new Error("db closed"));
    stubDeleteFetch({ a: 200, b: 200 });
    const meta = await runClaudeFileGc(gcArgs(dao));
    expect(meta.deletedRemote).toBe(2);
    expect(meta.pruneFailed).toBe(2);
    expect(meta.prunedRows).toBe(0);
  });

  it("404 也算已删 → 计 alreadyGone 且删本地行", async () => {
    const dao = createDao([record("a")]);
    stubDeleteFetch({ a: 404 });
    const meta = await runClaudeFileGc(gcArgs(dao));
    expect(meta.alreadyGone).toBe(1);
    expect(meta.deletedRemote).toBe(0);
    expect(dao.deleteByContentHashes).toHaveBeenCalledWith(["sha-a"]);
  });

  it("5xx 失败 → 保留本地行（不进删除集）", async () => {
    const dao = createDao([record("a"), record("b")]);
    stubDeleteFetch({ a: 200, b: 500 });
    const meta = await runClaudeFileGc(gcArgs(dao));
    expect(meta.deletedRemote).toBe(1);
    expect(meta.failed).toBe(1);
    expect(dao.deleteByContentHashes).toHaveBeenCalledWith(["sha-a"]);
  });

  it("freshness 复查：被并发 touch 顶新（lastUsedAt>=cutoff）→ 跳过不删", async () => {
    const stale = record("a"); // findIdle 里 lastUsedAt=epoch
    const dao = createDao([stale], {
      // 复查时 findByHash 回一个 lastUsedAt=now 的版本（又被用了）
      findByHash: vi.fn().mockResolvedValue(record("a", new Date())),
    });
    const fetchMock = stubDeleteFetch();
    const meta = await runClaudeFileGc(gcArgs(dao));
    expect(meta.skippedFresh).toBe(1);
    expect(meta.deletedRemote).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dao.deleteByContentHashes).not.toHaveBeenCalled();
  });

  it("freshness 复查：行已消失（findByHash null）→ 跳过", async () => {
    const dao = createDao([record("a")], { findByHash: vi.fn().mockResolvedValue(null) });
    const fetchMock = stubDeleteFetch();
    const meta = await runClaudeFileGc(gcArgs(dao));
    expect(meta.skippedFresh).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 → rateLimited 且停止本轮（后续候选不再处理）", async () => {
    const dao = createDao([record("a"), record("b"), record("c")]);
    stubDeleteFetch({ a: 429, b: 200, c: 200 });
    // concurrency=1 保证顺序：首个 429 即停
    const meta = await runClaudeFileGc(gcArgs(dao, { concurrency: 1 }));
    expect(meta.rateLimited).toBe(true);
    expect(meta.deletedRemote).toBe(0);
    expect(dao.deleteByContentHashes).not.toHaveBeenCalled();
  });

  it("getAccessToken 抛 → 整轮中止，不 findIdle、不删", async () => {
    const dao = createDao([record("a")]);
    const fetchMock = stubDeleteFetch();
    const meta = await runClaudeFileGc(
      gcArgs(dao, {
        getAccessToken: async () => {
          throw new Error("oauth refresh failed");
        },
      }),
    );
    expect(meta.failed).toBe(1);
    expect(meta.scanned).toBe(0);
    expect(dao.findIdle).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signal 已 abort → 扫到候选但不处理，aborted=true", async () => {
    const dao = createDao([record("a"), record("b")]);
    const fetchMock = stubDeleteFetch();
    const controller = new AbortController();
    controller.abort();
    const meta = await runClaudeFileGc(gcArgs(dao, { signal: controller.signal }));
    expect(meta.scanned).toBe(2);
    expect(meta.deletedRemote).toBe(0);
    expect(meta.aborted).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("findIdle 收到 limit=maxDeletionsPerRun", async () => {
    const dao = createDao([]);
    stubDeleteFetch();
    await runClaudeFileGc(gcArgs(dao, { maxDeletionsPerRun: 777 }));
    expect(dao.findIdle).toHaveBeenCalledWith(expect.objectContaining({ limit: 777 }));
  });

  it("混合结果：仅把成功(2xx)+404 的 hash 交给本地删除", async () => {
    const dao = createDao([record("ok"), record("gone"), record("fail")]);
    stubDeleteFetch({ ok: 200, gone: 404, fail: 500 });
    await runClaudeFileGc(gcArgs(dao));
    // 仅成功(2xx)+404 的 hash 被删本地行；500 的保留。逐条调用，flatten 后比对。
    const pruned = dao.deleteByContentHashes.mock.calls.flatMap(c => c[0] as string[]);
    expect(pruned.sort()).toEqual(["sha-gone", "sha-ok"]);
  });
});
