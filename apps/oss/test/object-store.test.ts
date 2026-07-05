import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initLoggerRuntime } from "@kagami/kernel/logger/runtime";
import type { LogEvent } from "@kagami/kernel/logger/types";
import { StdoutLogSink } from "@kagami/kernel/logger/sinks/stdout-sink";
import { ObjectStore, PayloadTooLargeError } from "../src/store/object-store.js";

// store 经 AppLogger 打日志（issue #274 统一日志格式），emit 前必须先初始化运行时。
initLoggerRuntime({ sinks: [new StdoutLogSink()] });

let blobDir: string;
let db: Database.Database;
let store: ObjectStore;

beforeEach(async () => {
  blobDir = await mkdtemp(path.join(tmpdir(), "oss-store-"));
  db = new Database(":memory:");
  store = new ObjectStore({ db, blobDir });
});

afterEach(async () => {
  db.close();
  await rm(blobDir, { recursive: true, force: true });
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** put 接受 Readable；测试里从 Buffer 造单块流（[bytes] 让整块作为一个 chunk 发出）。 */
function putBuffer(bytes: Buffer, mime: string, opts?: { maxBytes?: number }) {
  return store.put(Readable.from([bytes]), mime, opts);
}

/** get 返回流；测试里收拢成 Buffer 做逐字节比对。 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function refcountOf(sha: string): number | undefined {
  const row = db.prepare(`SELECT refcount FROM blob WHERE sha256 = ?`).get(sha) as
    | { refcount: number }
    | undefined;
  return row?.refcount;
}

async function countBlobFiles(): Promise<number> {
  let total = 0;
  let shards: string[];
  try {
    shards = await readdir(blobDir);
  } catch {
    return 0;
  }
  for (const shard of shards) {
    const shardDir = path.join(blobDir, shard);
    if (!(await stat(shardDir)).isDirectory()) {
      continue;
    }
    const files = await readdir(shardDir);
    total += files.filter(name => !name.includes(".tmp-")).length;
  }
  return total;
}

async function countTmpFiles(): Promise<number> {
  try {
    const entries = await readdir(path.join(blobDir, "tmp"));
    return entries.filter(name => name.includes(".tmp-")).length;
  } catch {
    return 0;
  }
}

function blobFilePath(bytes: Buffer): string {
  const sha = sha256(bytes);
  return path.join(blobDir, sha.slice(0, 2), sha);
}

describe("ObjectStore", () => {
  it("存新内容 → 1 个 blob 文件 + refcount=1 + key=res-1", async () => {
    const bytes = Buffer.from("hello oss");
    const { key } = await putBuffer(bytes, "text/plain");

    expect(key).toBe("res-1");
    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(1);
  });

  it("同内容再存 → 仍只 1 个文件, refcount=2, 返回不同 key", async () => {
    const bytes = Buffer.from("dup content");
    const first = await putBuffer(bytes, "text/plain");
    const second = await putBuffer(bytes, "text/plain");

    expect(first.key).toBe("res-1");
    expect(second.key).toBe("res-2");
    expect(first.key).not.toBe(second.key);
    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(2);
  });

  it("get 已存在 key → 字节与 mime 一致", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const { key } = await putBuffer(bytes, "image/png");

    const result = await store.get(key);
    expect(result).not.toBeNull();
    expect((await streamToBuffer(result!.stream)).equals(bytes)).toBe(true);
    expect(result?.mime).toBe("image/png");
    expect(result?.size).toBe(bytes.length);
  });

  it("get 未知 key → null", async () => {
    expect(await store.get("res-999")).toBeNull();
  });

  it("get / head / delete 收到畸形 key → null/false, 不抛", async () => {
    for (const bad of ["abc", "res-", "res-x", "res-0", "res-01a", "", "res--1"]) {
      expect(await store.get(bad)).toBeNull();
      expect(await store.head(bad)).toBeNull();
      expect(await store.delete(bad)).toBe(false);
    }
  });

  it("head → size/mime/sha256, 不读物理文件", async () => {
    const bytes = Buffer.from("head me");
    const { key } = await putBuffer(bytes, "application/octet-stream");
    const meta = await store.head(key);
    expect(meta).toEqual({
      mime: "application/octet-stream",
      size: bytes.length,
      sha256: sha256(bytes),
    });
  });

  it("删其中一个 key → 文件还在, refcount=1, 另一 key 仍可取", async () => {
    const bytes = Buffer.from("shared bytes");
    const a = await putBuffer(bytes, "text/plain");
    const b = await putBuffer(bytes, "text/plain");

    expect(await store.delete(a.key)).toBe(true);
    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(1);
    const got = await store.get(b.key);
    expect((await streamToBuffer(got!.stream)).equals(bytes)).toBe(true);
  });

  it("删最后一个 key → 文件被 GC, blob 行消失, get → null", async () => {
    const bytes = Buffer.from("solo bytes");
    const { key } = await putBuffer(bytes, "text/plain");

    expect(await store.delete(key)).toBe(true);
    expect(await countBlobFiles()).toBe(0);
    expect(refcountOf(sha256(bytes))).toBeUndefined();
    expect(await store.get(key)).toBeNull();
  });

  it("删不存在的 key → false, 不抛", async () => {
    expect(await store.delete("res-12345")).toBe(false);
  });

  it("自愈: blob 行在但文件被删 → put 同内容把文件幂等补回 + refcount+1", async () => {
    const bytes = Buffer.from("self heal");
    await putBuffer(bytes, "text/plain");
    await unlink(blobFilePath(bytes));
    expect(await countBlobFiles()).toBe(0);

    await putBuffer(bytes, "text/plain");
    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(2);
  });

  it("文件缺失 ≠ 不存在: 行在但 blob 文件被删 → get 抛错", async () => {
    const bytes = Buffer.from("missing file");
    const { key } = await putBuffer(bytes, "text/plain");
    await unlink(blobFilePath(bytes));

    await expect(store.get(key)).rejects.toThrow();
  });

  it("AUTOINCREMENT 不复用: 删 res-1 后再 put → res-2", async () => {
    const first = await putBuffer(Buffer.from("one"), "text/plain");
    expect(first.key).toBe("res-1");
    expect(await store.delete(first.key)).toBe(true);

    const second = await putBuffer(Buffer.from("two"), "text/plain");
    expect(second.key).toBe("res-2");
  });

  it("unlink 失败容错: 物理文件已被外部删 → delete 仍返回 true, 库行已删", async () => {
    const bytes = Buffer.from("orphan tolerance");
    const { key } = await putBuffer(bytes, "text/plain");
    await unlink(blobFilePath(bytes)); // 提交后 unlink 将抛 ENOENT，应被吞掉

    // 容错路径会经 AppLogger 记一条 best-effort 日志，属预期行为：换成捕获 sink 以免污染
    // 测试输出，同时断言确实走了该分支。
    const events: LogEvent[] = [];
    initLoggerRuntime({
      sinks: [
        {
          write: event => {
            events.push(event);
          },
        },
      ],
    });
    try {
      expect(await store.delete(key)).toBe(true);
      expect(refcountOf(sha256(bytes))).toBeUndefined();
      expect(events.some(event => event.metadata.event === "oss.unlink_orphan_failed")).toBe(true);
    } finally {
      initLoggerRuntime({ sinks: [new StdoutLogSink()] });
    }
  });

  it("并发 delete-last + 重新 put 同内容 → 新对象可读(写锁消除竞态)", async () => {
    // 回归测试:无写锁时,delete 的"提交后 unlink"会删掉 put 刚(以为还在而)复用的文件,
    // 留下不可读对象。写锁串行化两者后,无论谁先跑,最终对象的文件都在。
    const bytes = Buffer.from("race content");
    const first = await putBuffer(bytes, "text/plain");

    const [, second] = await Promise.all([store.delete(first.key), putBuffer(bytes, "text/plain")]);

    const got = await store.get(second.key);
    expect(got).not.toBeNull();
    expect((await streamToBuffer(got!.stream)).equals(bytes)).toBe(true);
    expect(await countBlobFiles()).toBe(1);
  });

  it("sweepOrphans: 删掉无 blob 行的孤儿文件, 保留被引用的文件", async () => {
    const real = Buffer.from("referenced");
    await putBuffer(real, "text/plain");

    const orphanShard = path.join(blobDir, "zz");
    await mkdir(orphanShard, { recursive: true });
    await writeFile(path.join(orphanShard, "z".repeat(64)), "garbage");

    expect(await countBlobFiles()).toBe(2);
    const swept = await store.sweepOrphans();
    expect(swept.removed).toBe(1);
    expect(await countBlobFiles()).toBe(1);
    // 被引用的文件仍在
    expect(await stat(blobFilePath(real))).toBeTruthy();
  });

  // ── 流式相关新增 ──

  it("put 超 maxBytes → 抛 PayloadTooLargeError, tmp/ 与 blob 均无残留", async () => {
    const big = Buffer.alloc(2048, 1);
    await expect(
      store.put(Readable.from([big]), "application/octet-stream", { maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(await countTmpFiles()).toBe(0);
    expect(await countBlobFiles()).toBe(0);
  });

  it("put 大对象(1MB 随机, 多 chunk) → 往返逐字节一致 + sha256 去重仍生效", async () => {
    const big = randomBytes(1024 * 1024);
    // 拆成多块喂入，逼真流式路径（触发 write 背压 / drain）。
    const chunks = [
      big.subarray(0, 400_000),
      big.subarray(400_000, 800_000),
      big.subarray(800_000),
    ];
    const a = await store.put(Readable.from(chunks), "application/octet-stream");
    const b = await putBuffer(big, "application/octet-stream");

    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(big))).toBe(2);
    const got = await store.get(a.key);
    expect((await streamToBuffer(got!.stream)).equals(big)).toBe(true);
    expect(got?.size).toBe(big.length);
    expect(b.key).not.toBe(a.key);
  });

  it("get 的 stream 未读完即 destroy → 触发 close(fd 释放, 不挂起)", async () => {
    const bytes = randomBytes(256 * 1024);
    const { key } = await putBuffer(bytes, "application/octet-stream");
    const result = await store.get(key);
    expect(result).not.toBeNull();
    result!.stream.destroy();
    // autoClose:true → destroy 后 close 事件必触发；不触发则该 await 超时失败。
    await once(result!.stream, "close");
  });

  it("并发 put 同新内容两份 → 1 文件 + refcount=2 + 两个不同 key", async () => {
    const bytes = Buffer.from("concurrent new content");
    const [a, b] = await Promise.all([
      putBuffer(bytes, "text/plain"),
      putBuffer(bytes, "text/plain"),
    ]);

    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(2);
    expect(a.key).not.toBe(b.key);
  });

  it("sweepOrphans 清理 blobDir/tmp 下残留 .tmp- 文件", async () => {
    const tmpDir = path.join(blobDir, "tmp");
    await mkdir(tmpDir, { recursive: true });
    await writeFile(path.join(tmpDir, `${"a".repeat(8)}.tmp-orphan`), "garbage");
    await writeFile(path.join(tmpDir, `${"b".repeat(8)}.tmp-orphan`), "garbage");

    const swept = await store.sweepOrphans();
    expect(swept.removed).toBe(2);
    expect(await countTmpFiles()).toBe(0);
  });
});

describe("ObjectStore 控制台只读面（list / stats）", () => {
  it("list：按 id 倒序分页 + total", async () => {
    const a = await putBuffer(Buffer.from("obj-a"), "text/plain");
    const b = await putBuffer(Buffer.from("obj-b"), "image/png");
    const c = await putBuffer(Buffer.from("obj-c"), "text/plain");

    const page1 = store.list({ page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.items.map(row => row.id)).toEqual([parseId(c.key), parseId(b.key)]);

    const page2 = store.list({ page: 2, pageSize: 2 });
    expect(page2.items.map(row => row.id)).toEqual([parseId(a.key)]);
  });

  it("list：mime 精确过滤", async () => {
    await putBuffer(Buffer.from("t1"), "text/plain");
    await putBuffer(Buffer.from("i1"), "image/png");

    const onlyPng = store.list({ page: 1, pageSize: 20, mime: "image/png" });
    expect(onlyPng.total).toBe(1);
    expect(onlyPng.items).toHaveLength(1);
    expect(onlyPng.items[0]!.mime).toBe("image/png");
  });

  it("list 行携带 size/sha256/refcount（去重共享内容 refcount>1）", async () => {
    const bytes = Buffer.from("dup content");
    await putBuffer(bytes, "text/plain");
    await putBuffer(bytes, "text/plain");

    const { items } = store.list({ page: 1, pageSize: 20 });
    expect(items).toHaveLength(2);
    for (const row of items) {
      expect(row.size).toBe(bytes.length);
      expect(row.sha256).toBe(sha256(bytes));
      expect(row.refcount).toBe(2);
    }
  });

  it("stats：去重场景 objectCount/blobCount/物理/名义/节省口径", async () => {
    const dup = Buffer.from("same-bytes");
    await putBuffer(dup, "text/plain"); // object#1 → blob X（refcount→1）
    await putBuffer(dup, "text/plain"); // object#2 → blob X（refcount→2，不新增物理文件）
    const uniq = Buffer.from("unique-bytes-xyz");
    await putBuffer(uniq, "image/png"); // object#3 → blob Y

    const s = store.stats();
    expect(s.objectCount).toBe(3);
    expect(s.blobCount).toBe(2);
    expect(s.physicalBytes).toBe(dup.length + uniq.length);
    expect(s.logicalBytes).toBe(dup.length * 2 + uniq.length);
    expect(s.logicalBytes - s.physicalBytes).toBe(dup.length);
  });

  it("stats：空库全 0", () => {
    expect(store.stats()).toEqual({
      objectCount: 0,
      blobCount: 0,
      physicalBytes: 0,
      logicalBytes: 0,
    });
  });
});

function parseId(key: string): number {
  return Number(key.slice("res-".length));
}
