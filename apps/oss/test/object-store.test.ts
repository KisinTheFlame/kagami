import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectStore } from "../src/store/object-store.js";

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

function blobFilePath(bytes: Buffer): string {
  const sha = sha256(bytes);
  return path.join(blobDir, sha.slice(0, 2), sha);
}

describe("ObjectStore", () => {
  it("存新内容 → 1 个 blob 文件 + refcount=1 + key=res-1", async () => {
    const bytes = Buffer.from("hello oss");
    const { key } = await store.put(bytes, "text/plain");

    expect(key).toBe("res-1");
    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(1);
  });

  it("同内容再存 → 仍只 1 个文件, refcount=2, 返回不同 key", async () => {
    const bytes = Buffer.from("dup content");
    const first = await store.put(bytes, "text/plain");
    const second = await store.put(bytes, "text/plain");

    expect(first.key).toBe("res-1");
    expect(second.key).toBe("res-2");
    expect(first.key).not.toBe(second.key);
    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(2);
  });

  it("get 已存在 key → 字节与 mime 一致", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const { key } = await store.put(bytes, "image/png");

    const result = await store.get(key);
    expect(result).not.toBeNull();
    expect(result?.bytes.equals(bytes)).toBe(true);
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
    const { key } = await store.put(bytes, "application/octet-stream");
    const meta = await store.head(key);
    expect(meta).toEqual({
      mime: "application/octet-stream",
      size: bytes.length,
      sha256: sha256(bytes),
    });
  });

  it("删其中一个 key → 文件还在, refcount=1, 另一 key 仍可取", async () => {
    const bytes = Buffer.from("shared bytes");
    const a = await store.put(bytes, "text/plain");
    const b = await store.put(bytes, "text/plain");

    expect(await store.delete(a.key)).toBe(true);
    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(1);
    expect((await store.get(b.key))?.bytes.equals(bytes)).toBe(true);
  });

  it("删最后一个 key → 文件被 GC, blob 行消失, get → null", async () => {
    const bytes = Buffer.from("solo bytes");
    const { key } = await store.put(bytes, "text/plain");

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
    await store.put(bytes, "text/plain");
    await unlink(blobFilePath(bytes));
    expect(await countBlobFiles()).toBe(0);

    await store.put(bytes, "text/plain");
    expect(await countBlobFiles()).toBe(1);
    expect(refcountOf(sha256(bytes))).toBe(2);
  });

  it("文件缺失 ≠ 不存在: 行在但 blob 文件被删 → get 抛错", async () => {
    const bytes = Buffer.from("missing file");
    const { key } = await store.put(bytes, "text/plain");
    await unlink(blobFilePath(bytes));

    await expect(store.get(key)).rejects.toThrow();
  });

  it("AUTOINCREMENT 不复用: 删 res-1 后再 put → res-2", async () => {
    const first = await store.put(Buffer.from("one"), "text/plain");
    expect(first.key).toBe("res-1");
    expect(await store.delete(first.key)).toBe(true);

    const second = await store.put(Buffer.from("two"), "text/plain");
    expect(second.key).toBe("res-2");
  });

  it("unlink 失败容错: 物理文件已被外部删 → delete 仍返回 true, 库行已删", async () => {
    const bytes = Buffer.from("orphan tolerance");
    const { key } = await store.put(bytes, "text/plain");
    await unlink(blobFilePath(bytes)); // 提交后 unlink 将抛 ENOENT，应被吞掉

    // 容错路径会 console.error 一条 best-effort 日志，属预期行为：spy 掉以免污染测试输出，
    // 同时断言确实走了该分支。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await store.delete(key)).toBe(true);
      expect(refcountOf(sha256(bytes))).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("unlink orphan blob failed"),
        expect.anything(),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("并发 delete-last + 重新 put 同内容 → 新对象可读(写锁消除竞态)", async () => {
    // 回归测试:无写锁时,delete 的"提交后 unlink"会删掉 put 刚(以为还在而)复用的文件,
    // 留下不可读对象。写锁串行化两者后,无论谁先跑,最终对象的文件都在。
    const bytes = Buffer.from("race content");
    const first = await store.put(bytes, "text/plain");

    const [, second] = await Promise.all([store.delete(first.key), store.put(bytes, "text/plain")]);

    const got = await store.get(second.key);
    expect(got).not.toBeNull();
    expect(got?.bytes.equals(bytes)).toBe(true);
    expect(await countBlobFiles()).toBe(1);
  });

  it("sweepOrphans: 删掉无 blob 行的孤儿文件, 保留被引用的文件", async () => {
    const real = Buffer.from("referenced");
    await store.put(real, "text/plain");

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
});
