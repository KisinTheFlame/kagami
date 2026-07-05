import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveClaudeImageFileIds } from "../src/providers/claude-file-upload.js";
import type {
  ClaudeFileCacheDao,
  ClaudeFileCacheRecord,
  ClaudeFileCacheSaveInput,
} from "../src/providers/claude-file-cache.dao.js";
import type { LlmChatRequest } from "../src/types.js";

/** 内存版缓存 DAO：save 落库、findByHash 读库，供跨调用的命中路径验证。 */
function createFakeDao(): ClaudeFileCacheDao & {
  findByHash: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  touch: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, ClaudeFileCacheRecord>();
  return {
    findByHash: vi.fn(async (contentSha256: string) => store.get(contentSha256) ?? null),
    save: vi.fn(async (input: ClaudeFileCacheSaveInput) => {
      store.set(input.contentSha256, { ...input, lastUsedAt: new Date() });
    }),
    touch: vi.fn(async () => {}),
    findIdle: vi.fn(async () => []),
    deleteByContentHashes: vi.fn(async () => 0),
  };
}

/** 每次上传返回**不同** file id：若发生重复上传，孤儿（第二个 id）会在断言中暴露。 */
function stubUploadFetch(): { fetchMock: ReturnType<typeof vi.fn>; uploadCount: () => number } {
  let count = 0;
  const fetchMock = vi.fn(async () => {
    count += 1;
    return new Response(JSON.stringify({ id: `file_${count}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, uploadCount: () => count };
}

function imageRequest(base64: string): LlmChatRequest {
  return {
    messages: [
      {
        role: "user",
        content: [{ type: "image", content: base64, mimeType: "image/png", filename: "x.png" }],
      },
    ],
    tools: [],
    toolChoice: "auto",
  };
}

function base64Of(text: string): string {
  return Buffer.from(text).toString("base64");
}

const baseParams = {
  baseUrl: "https://api.anthropic.com",
  anthropicBeta: "files-api-2025-04-14",
  timeoutMs: 10_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveClaudeImageFileIds — 并发单飞（防孤儿）", () => {
  it("同一张新图的并发解析只上传一次、只落缓存一次，双方拿到同一个 file_id", async () => {
    const dao = createFakeDao();
    const { fetchMock, uploadCount } = stubUploadFetch();
    const base64 = base64Of("同一张图-并发");
    const getAccessToken = vi.fn(async () => "token");

    // 两个独立的 resolve 调用（模拟主 Agent + task agent 同轮并发），带同一张新图。
    const [a, b] = await Promise.all([
      resolveClaudeImageFileIds({
        request: imageRequest(base64),
        fileCacheDao: dao,
        getAccessToken,
        ...baseParams,
      }),
      resolveClaudeImageFileIds({
        request: imageRequest(base64),
        fileCacheDao: dao,
        getAccessToken,
        ...baseParams,
      }),
    ]);

    // 只上传一次 → 不产生孤儿；只 save 一次 → 缓存无覆盖竞态。
    expect(uploadCount()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dao.save).toHaveBeenCalledTimes(1);
    // 双方拿到同一个（唯一被落库的）file_id。
    expect(a.get(base64)).toBe("file_1");
    expect(b.get(base64)).toBe("file_1");
  });

  it("首次上传落库后，后续解析走缓存命中、不再上传（单飞 settle 后正确释放）", async () => {
    const dao = createFakeDao();
    const { fetchMock } = stubUploadFetch();
    const base64 = base64Of("先传后命中");
    const getAccessToken = vi.fn(async () => "token");

    const first = await resolveClaudeImageFileIds({
      request: imageRequest(base64),
      fileCacheDao: dao,
      getAccessToken,
      ...baseParams,
    });
    const second = await resolveClaudeImageFileIds({
      request: imageRequest(base64),
      fileCacheDao: dao,
      getAccessToken,
      ...baseParams,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1); // 仅首次上传
    expect(dao.touch).toHaveBeenCalled(); // 第二次走命中刷新
    expect(first.get(base64)).toBe("file_1");
    expect(second.get(base64)).toBe("file_1");
  });

  it("并发同图上传失败：winner 与复用者都回退 base64（不写入 fileId、不落缓存）", async () => {
    const dao = createFakeDao();
    // 上传恒失败（HTTP 500）→ uploadClaudeFile 抛错 → 单飞 Promise reject。
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const base64 = base64Of("并发失败");
    const getAccessToken = vi.fn(async () => "token");

    const [a, b] = await Promise.all([
      resolveClaudeImageFileIds({
        request: imageRequest(base64),
        fileCacheDao: dao,
        getAccessToken,
        ...baseParams,
      }),
      resolveClaudeImageFileIds({
        request: imageRequest(base64),
        fileCacheDao: dao,
        getAccessToken,
        ...baseParams,
      }),
    ]);

    // 仍只尝试上传一次（并发合并），失败不落缓存；双方都回退 base64 → map 不含该图。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dao.save).not.toHaveBeenCalled();
    expect(a.has(base64)).toBe(false);
    expect(b.has(base64)).toBe(false);
  });

  it("不同图片内容各自上传（单飞按 sha256 隔离，不误合并）", async () => {
    const dao = createFakeDao();
    const { fetchMock } = stubUploadFetch();
    const a64 = base64Of("图A");
    const b64 = base64Of("图B");
    const getAccessToken = vi.fn(async () => "token");

    const resolved = await Promise.all([
      resolveClaudeImageFileIds({
        request: imageRequest(a64),
        fileCacheDao: dao,
        getAccessToken,
        ...baseParams,
      }),
      resolveClaudeImageFileIds({
        request: imageRequest(b64),
        fileCacheDao: dao,
        getAccessToken,
        ...baseParams,
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resolved[0].get(a64)).not.toBe(resolved[1].get(b64));
  });
});
