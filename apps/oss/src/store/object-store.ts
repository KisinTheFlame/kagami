import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";

/**
 * 业务无关的内容寻址对象仓库（只认字节 + mime）。
 *
 *   命名层 (object)            内容层 (blob)          物理层 (filesystem)
 *   ┌───────────────┐        ┌────────────────┐     ┌────────────────────────────┐
 *   │ id (AUTOINCR) │───┐    │ sha256 (PK)    │     │ blobs/<sha[0:2]>/<sha256>  │
 *   │ sha256 ───────┼───┼───▶│ refcount       │────▶│ (裸字节, 无扩展名)          │
 *   │ mime          │   │    │ size           │     └────────────────────────────┘
 *   └───────────────┘   │    └────────────────┘
 *   对外 key="res-"+id  │    多 object 可指向同一 blob(去重); refcount 计活引用
 *                       └── 删 key 仅 -1; 归零才删 blob 行 + 物理文件
 *
 * 崩溃一致性: 文件 I/O 不在 SQLite 事务内(rename/unlink 无法纳入事务)。库是唯一事实来源 ——
 * 对外可见性只取决于行在不在。次序刻意排成"崩溃只留无害孤儿, 绝不出现库说有/文件没有的可见对象":
 *   put:    先落盘(rename, 幂等) ─▶ 再提交事务         崩在中间 = 孤儿文件(没人引用)
 *   delete: 先提交事务(删行)     ─▶ 再 best-effort unlink  崩在中间 = 孤儿文件(没人引用)
 * 孤儿文件由 sweepOrphans() 在启动时回收。
 */

const SHARD_PREFIX_LENGTH = 2;
const KEY_PREFIX = "res-";

export interface PutResult {
  key: string;
}

export interface GetResult {
  bytes: Buffer;
  mime: string;
  size: number;
}

export interface HeadResult {
  mime: string;
  size: number;
  sha256: string;
}

interface ObjectRow {
  sha256: string;
  mime: string;
}

interface BlobRefcountRow {
  refcount: number;
}

interface BlobSizeRow {
  size: number;
}

interface DeleteOutcome {
  found: boolean;
  /** 归零需要在事务提交后 unlink 的 sha256；否则 null。 */
  orphanSha256: string | null;
}

export class ObjectStore {
  private readonly db: Database.Database;
  private readonly blobDir: string;

  public constructor({ db, blobDir }: { db: Database.Database; blobDir: string }) {
    this.db = db;
    this.blobDir = blobDir;
    this.applySchema();
  }

  /** 启动时幂等建表 + PRAGMA。裸 better-sqlite3 不显式开 FK 则 REFERENCES 形同虚设。 */
  private applySchema(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blob (
        sha256     TEXT PRIMARY KEY,
        size       INTEGER NOT NULL,
        refcount   INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS object (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        sha256     TEXT NOT NULL REFERENCES blob(sha256),
        mime       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_object_sha256 ON object(sha256);
    `);
  }

  public async put(bytes: Buffer, mime: string): Promise<PutResult> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    // 1) 先把字节落盘（事务外）。幂等：已存在则跳过，缺失则补回（自愈历史半成品）。
    //    只保证"字节在盘上"，不据此做 refcount 决策（避免 fs 检查与事务自增分离的 TOCTOU）。
    await this.ensureBlobFile(sha256, bytes);

    // 2) refcount 决策完全基于库行：upsert blob，再插 object，取自增 id 拼 key。
    const now = Date.now();
    const insert = this.db.transaction((): number => {
      this.db
        .prepare(
          `INSERT INTO blob (sha256, size, refcount, created_at)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(sha256) DO UPDATE SET refcount = refcount + 1`,
        )
        .run(sha256, bytes.length, now);
      const info = this.db
        .prepare(`INSERT INTO object (sha256, mime, created_at) VALUES (?, ?, ?)`)
        .run(sha256, mime, now);
      return Number(info.lastInsertRowid);
    });

    return { key: `${KEY_PREFIX}${insert()}` };
  }

  public async get(key: string): Promise<GetResult | null> {
    const id = parseKey(key);
    if (id === null) {
      return null;
    }
    const row = this.db.prepare(`SELECT sha256, mime FROM object WHERE id = ?`).get(id) as
      | ObjectRow
      | undefined;
    if (!row) {
      return null;
    }
    // 文件读失败（行在文件没）刻意抛出，由 HTTP 层映射成 500，绝不用 null 掩盖文件丢失。
    const bytes = await readFile(this.blobPath(row.sha256));
    return { bytes, mime: row.mime, size: bytes.length };
  }

  public async head(key: string): Promise<HeadResult | null> {
    const id = parseKey(key);
    if (id === null) {
      return null;
    }
    const row = this.db.prepare(`SELECT sha256, mime FROM object WHERE id = ?`).get(id) as
      | ObjectRow
      | undefined;
    if (!row) {
      return null;
    }
    // size 取自 blob 行（权威），head 不读物理文件。
    const blob = this.db.prepare(`SELECT size FROM blob WHERE sha256 = ?`).get(row.sha256) as
      | BlobSizeRow
      | undefined;
    return { mime: row.mime, size: blob?.size ?? 0, sha256: row.sha256 };
  }

  public async delete(key: string): Promise<boolean> {
    const id = parseKey(key);
    if (id === null) {
      return false;
    }

    const remove = this.db.transaction((): DeleteOutcome => {
      const row = this.db.prepare(`SELECT sha256 FROM object WHERE id = ?`).get(id) as
        | Pick<ObjectRow, "sha256">
        | undefined;
      if (!row) {
        return { found: false, orphanSha256: null };
      }
      this.db.prepare(`DELETE FROM object WHERE id = ?`).run(id);
      const blob = this.db.prepare(`SELECT refcount FROM blob WHERE sha256 = ?`).get(row.sha256) as
        | BlobRefcountRow
        | undefined;
      if (blob && blob.refcount <= 1) {
        this.db.prepare(`DELETE FROM blob WHERE sha256 = ?`).run(row.sha256);
        return { found: true, orphanSha256: row.sha256 };
      }
      if (blob) {
        this.db.prepare(`UPDATE blob SET refcount = refcount - 1 WHERE sha256 = ?`).run(row.sha256);
      }
      return { found: true, orphanSha256: null };
    });

    const outcome = remove();
    if (!outcome.found) {
      return false;
    }
    if (outcome.orphanSha256) {
      // 提交后 best-effort 删物理文件；失败仅记日志（留下的也是无害孤儿，等 sweep 回收）。
      await this.unlinkBlobBestEffort(outcome.orphanSha256);
    }
    return true;
  }

  /**
   * 扫 blobs/ 目录，删掉库里没有对应 blob 行的孤儿文件（崩溃窗口 / unlink 失败 / 残留 .tmp 残片）。
   * 只处理"文件在、行不在"；"行在、文件不在"由 put 的自愈分支负责。启动时跑一次。
   */
  public async sweepOrphans(): Promise<{ removed: number }> {
    let removed = 0;
    let shards: string[];
    try {
      shards = await readdir(this.blobDir);
    } catch {
      return { removed: 0 };
    }

    const blobExists = this.db.prepare(`SELECT 1 FROM blob WHERE sha256 = ?`);
    for (const shard of shards) {
      const shardDir = path.join(this.blobDir, shard);
      let entries: string[];
      try {
        if (!(await stat(shardDir)).isDirectory()) {
          continue;
        }
        entries = await readdir(shardDir);
      } catch {
        continue;
      }
      for (const name of entries) {
        // 崩溃残留的临时写入文件也是孤儿。
        const isOrphan = name.includes(".tmp-") || blobExists.get(name) === undefined;
        if (!isOrphan) {
          continue;
        }
        try {
          await unlink(path.join(shardDir, name));
          removed += 1;
        } catch (error) {
          console.error(`[oss] sweep unlink failed: ${path.join(shard, name)}`, error);
        }
      }
    }
    return { removed };
  }

  private blobPath(sha256: string): string {
    return path.join(this.blobDir, sha256.slice(0, SHARD_PREFIX_LENGTH), sha256);
  }

  /** 幂等落盘：已存在则跳过；缺失则写临时文件再原子 rename（杜绝半截文件）。 */
  private async ensureBlobFile(sha256: string, bytes: Buffer): Promise<void> {
    const finalPath = this.blobPath(sha256);
    try {
      await stat(finalPath);
      return;
    } catch {
      // 不存在，落盘。
    }
    await mkdir(path.dirname(finalPath), { recursive: true });
    const tmpPath = `${finalPath}.tmp-${randomUUID()}`;
    await writeFile(tmpPath, bytes);
    await rename(tmpPath, finalPath);
  }

  private async unlinkBlobBestEffort(sha256: string): Promise<void> {
    try {
      await unlink(this.blobPath(sha256));
    } catch (error) {
      console.error(`[oss] unlink orphan blob failed: ${sha256}`, error);
    }
  }
}

/** 解析对外 key：`res-<正整数>` → id；前缀不对 / 非正整数 / 越界 → null（视作无映射）。 */
function parseKey(key: string): number | null {
  if (!key.startsWith(KEY_PREFIX)) {
    return null;
  }
  const rest = key.slice(KEY_PREFIX.length);
  if (!/^[0-9]+$/.test(rest)) {
    return null;
  }
  const id = Number(rest);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return id;
}
