import { createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type Database from "better-sqlite3";

/**
 * Typed content-addressed object store（对标 S3 / MinIO）。对外是「bytes + content-type」的
 * 对象——content-type 是对象的一等元数据，原样存、原样回，服务端不嗅探也不改写（信任写入方
 * 传来的 mime，缺失则 application/octet-stream）。内容寻址去重（sha256）是纯内部实现细节，
 * 对外不可见、不影响对象语义。
 *
 * put/get 走流式：字节不整块驻留内存，峰值内存 O(chunk) 而非 O(对象大小)。
 *
 *   命名层 (object)            内容层 (blob)          物理层 (filesystem)
 *   ┌───────────────┐        ┌────────────────┐     ┌────────────────────────────┐
 *   │ id (AUTOINCR) │───┐    │ sha256 (PK)    │     │ blobs/<sha[0:2]>/<sha256>  │
 *   │ sha256 ───────┼───┼───▶│ refcount       │────▶│ (裸字节, 无扩展名)          │
 *   │ mime          │   │    │ size           │     └────────────────────────────┘
 *   └───────────────┘   │    └────────────────┘     临时: blobs/tmp/<uuid>.tmp-<uuid>
 *   对外 key="res-"+id  │    多 object 可指向同一 blob(去重); refcount 计活引用
 *                       └── 删 key 仅 -1; 归零才删 blob 行 + 物理文件
 *
 * 流式 put 的两段式：字节写入在写锁外（边流边算 sha256 落 tmp/ 临时文件，慢速大上传不再串行
 * 阻塞其它写），只有 final-path 存在性检查 + rename + 事务在写锁内（临界区仅剩快操作）。临时文件
 * 因此必须放专用 tmp/ 子目录，让 sweepOrphans 能回收崩溃残留。
 *
 * 崩溃一致性: 文件 I/O 不在 SQLite 事务内(rename/unlink 无法纳入事务)。库是唯一事实来源 ——
 * 对外可见性只取决于行在不在。次序刻意排成"崩溃只留无害孤儿, 绝不出现库说有/文件没有的可见对象":
 *   put:    先落盘(rename, 幂等) ─▶ 再提交事务         崩在中间 = 孤儿文件(没人引用)
 *   delete: 先提交事务(删行)     ─▶ 再 best-effort unlink  崩在中间 = 孤儿文件(没人引用)
 * 孤儿文件（含 tmp/ 残留）由 sweepOrphans() 在启动时回收。
 *
 * 并发一致性: put/delete 的 rename/unlink 在事务外、且 await 处让出事件循环。若不串行化,delete 的
 * "提交后 unlink" 会删掉一个并发 put 刚重建的 blob 文件,留下"库说有、文件没有"的不可读对象。
 * 故 put 的 rename + 事务、delete 的事务 + unlink 走同一把进程内写锁串行化;读(get/head)不加锁、
 * 可并发。get 先 open fd 再返回:db 查行与 open 之间仍有与旧实现一致的 unlink 窗口(→ENOENT→抛错),
 * 但 fd 一旦打开即免疫后续 unlink(POSIX 已打开 fd 保住 inode)。
 */

const SHARD_PREFIX_LENGTH = 2;
const KEY_PREFIX = "res-";
const TMP_DIR_NAME = "tmp";

/** put 的字节流超过调用方给定的 maxBytes 上限时抛出；HTTP 层映射成 413。 */
export class PayloadTooLargeError extends Error {}

export interface PutResult {
  key: string;
}

export interface GetResult {
  /** 对象字节的只读流。调用方必须消费到底或 destroy()，否则泄漏底层 fd。 */
  stream: Readable;
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
  private readonly tmpDir: string;
  /** 串行化写操作的临界区(put 的 rename+事务 / delete 的事务+unlink),消除文件 I/O 与事务分离带来的并发竞态。读不走它。 */
  private readonly writeLock = new Mutex();

  public constructor({ db, blobDir }: { db: Database.Database; blobDir: string }) {
    this.db = db;
    this.blobDir = blobDir;
    this.tmpDir = path.join(blobDir, TMP_DIR_NAME);
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

  /**
   * 流式存入。字节写入在写锁外（边流边算 sha256 落 tmp/），只有 rename + 事务在写锁内。
   * 超限（maxBytes）抛 PayloadTooLargeError；此时刻意不销毁 source，让 HTTP 层能把 413 写回。
   */
  public async put(
    source: Readable,
    mime: string,
    opts?: { maxBytes?: number },
  ): Promise<PutResult> {
    const maxBytes = opts?.maxBytes;

    // 1) 锁外：边流边算 sha256 + 计数，落随机名临时文件（专用 tmp/ 子目录，能被 sweep 回收）。
    await mkdir(this.tmpDir, { recursive: true });
    const tmpPath = path.join(this.tmpDir, `${randomUUID()}.tmp-${randomUUID()}`);
    const hash = createHash("sha256");
    let size = 0;
    const writeStream = createWriteStream(tmpPath);
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => {
          reject(err);
        };
        source.on("error", onError);
        writeStream.on("error", onError);
        source.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (maxBytes !== undefined && size > maxBytes) {
            // 只 reject 不销毁 source：让 handlePost 能写回 413 再收尾（避免客户端只见 ECONNRESET）。
            reject(new PayloadTooLargeError(`对象超过 ${maxBytes} 字节上限`));
            return;
          }
          hash.update(chunk);
          if (!writeStream.write(chunk)) {
            source.pause();
            writeStream.once("drain", () => {
              source.resume();
            });
          }
        });
        source.on("end", () => {
          writeStream.end(() => {
            resolve();
          });
        });
      });
    } catch (error) {
      writeStream.destroy();
      await unlink(tmpPath).catch(() => {});
      throw error;
    }

    const sha256 = hash.digest("hex");

    // 2) 锁内：final-path 存在性检查 + rename + 事务全部串行（不可提前到锁外，否则重开 delete-last/put 竞态）。
    return this.writeLock.run(async () => {
      await this.ensureBlobFileFromTemp(sha256, tmpPath);
      const now = Date.now();
      const insert = this.db.transaction((): number => {
        this.db
          .prepare(
            `INSERT INTO blob (sha256, size, refcount, created_at)
             VALUES (?, ?, 1, ?)
             ON CONFLICT(sha256) DO UPDATE SET refcount = refcount + 1`,
          )
          .run(sha256, size, now);
        const info = this.db
          .prepare(`INSERT INTO object (sha256, mime, created_at) VALUES (?, ?, ?)`)
          .run(sha256, mime, now);
        return Number(info.lastInsertRowid);
      });
      return { key: `${KEY_PREFIX}${insert()}` };
    });
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
    // size 取自 blob 行（权威，与 head 一致）；流不逐字节回算长度。
    const blob = this.db.prepare(`SELECT size FROM blob WHERE sha256 = ?`).get(row.sha256) as
      | BlobSizeRow
      | undefined;
    // 先 open fd：文件缺失（行在文件没）刻意抛出，由 HTTP 层映射成 500，绝不用 null 掩盖文件丢失。
    // fd 一旦打开即免疫并发 delete 的 unlink。autoClose：流结束 / 出错 / destroy 时自动关 fd，防泄漏。
    const handle = await open(this.blobPath(row.sha256), "r");
    let stream;
    try {
      stream = handle.createReadStream({ autoClose: true });
    } catch (error) {
      await handle.close();
      throw error;
    }
    return { stream, mime: row.mime, size: blob?.size ?? 0 };
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

    // 写锁串行化：提交后 unlink 与并发 put 的 rename 不会交错（见类头"并发一致性"）。
    return this.writeLock.run(async () => {
      const remove = this.db.transaction((): DeleteOutcome => {
        const row = this.db.prepare(`SELECT sha256 FROM object WHERE id = ?`).get(id) as
          | Pick<ObjectRow, "sha256">
          | undefined;
        if (!row) {
          return { found: false, orphanSha256: null };
        }
        this.db.prepare(`DELETE FROM object WHERE id = ?`).run(id);
        const blob = this.db
          .prepare(`SELECT refcount FROM blob WHERE sha256 = ?`)
          .get(row.sha256) as BlobRefcountRow | undefined;
        if (blob && blob.refcount <= 1) {
          this.db.prepare(`DELETE FROM blob WHERE sha256 = ?`).run(row.sha256);
          return { found: true, orphanSha256: row.sha256 };
        }
        if (blob) {
          this.db
            .prepare(`UPDATE blob SET refcount = refcount - 1 WHERE sha256 = ?`)
            .run(row.sha256);
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
    });
  }

  /**
   * 扫 blobs/ 目录，删掉库里没有对应 blob 行的孤儿文件（崩溃窗口 / unlink 失败 / tmp/ 残片）。
   * 只处理"文件在、行不在"；"行在、文件不在"由 put 的自愈分支负责。启动时跑一次。
   * tmp/ 子目录里的文件名都含 ".tmp-"，一律视作孤儿清理。
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
        // 崩溃残留的临时写入文件（含 tmp/ 目录里的）也是孤儿。
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

  /**
   * 把流式落好的临时文件转正为 blob（锁内调用）：目标已存在（去重）则丢弃临时文件；
   * 否则建分片目录 + 原子 rename。杜绝半截文件（临时文件本身已是完整字节）。
   */
  private async ensureBlobFileFromTemp(sha256: string, tmpPath: string): Promise<void> {
    const finalPath = this.blobPath(sha256);
    try {
      await stat(finalPath);
      // 已存在（去重）：临时文件无用，丢弃。
      await unlink(tmpPath).catch(() => {});
      return;
    } catch {
      // 不存在，落盘。
    }
    await mkdir(path.dirname(finalPath), { recursive: true });
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

/**
 * 极简进程内互斥锁:把异步操作串成一条链,后来的等前一个完成再跑。用于串行化写操作的临界区,
 * 消除"文件 I/O 在事务外 + await 让出事件循环"导致的并发竞态。
 */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  public async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}
