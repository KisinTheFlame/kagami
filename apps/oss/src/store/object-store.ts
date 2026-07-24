import { createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { Database } from "../infra/db/client.js";

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
 * 库经 Prisma（better-sqlite3 adapter）接入；schema 由 prisma/migrations 拥有，进程只连不建表。
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

const logger = new AppLogger({ source: "oss-store" });

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

interface DeleteOutcome {
  found: boolean;
  /** 归零需要在事务提交后 unlink 的 sha256；否则 null。 */
  orphanSha256: string | null;
}

/** 控制台对象浏览的列表行（object ⋈ blob，size/refcount 取自权威的 blob 行）。 */
interface ObjectListRow {
  /** object 表自增 id；对外 key = `res-<id>`（映射在 HTTP 层完成）。 */
  id: number;
  mime: string;
  size: number;
  sha256: string;
  refcount: number;
  /** Unix ms（object.created_at）。 */
  createdAt: number;
}

export interface ObjectListPage {
  items: ObjectListRow[];
  total: number;
}

/** 存储统计。dedupSavedBytes 由 HTTP 层用 logical-physical 算出，此处只回原始聚合。 */
export interface StorageStats {
  objectCount: number;
  blobCount: number;
  physicalBytes: number;
  logicalBytes: number;
}

export class ObjectStore {
  private readonly db: Database;
  private readonly blobDir: string;
  private readonly tmpDir: string;
  /** 串行化写操作的临界区(put 的 rename+事务 / delete 的事务+unlink),消除文件 I/O 与事务分离带来的并发竞态。读不走它。 */
  private readonly writeLock = new Mutex();

  public constructor({ db, blobDir }: { db: Database; blobDir: string }) {
    this.db = db;
    this.blobDir = blobDir;
    this.tmpDir = path.join(blobDir, TMP_DIR_NAME);
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
      const key = await this.db.$transaction(async tx => {
        // blob 缺则建（refcount=1），已存在则 +1（去重：不改 size/created_at）。
        await tx.blob.upsert({
          where: { sha256 },
          create: { sha256, size, refcount: 1, createdAt: now },
          update: { refcount: { increment: 1 } },
        });
        const object = await tx.object.create({ data: { sha256, mime, createdAt: now } });
        return `${KEY_PREFIX}${object.id}`;
      });
      return { key };
    });
  }

  public async get(key: string): Promise<GetResult | null> {
    const id = parseKey(key);
    if (id === null) {
      return null;
    }
    // size 取自 blob 行（权威，与 head 一致）；一次 join 拿 mime + size，流不逐字节回算长度。
    const row = await this.db.object.findUnique({
      where: { id },
      include: { blob: { select: { size: true } } },
    });
    if (!row) {
      return null;
    }
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
    return { stream, mime: row.mime, size: row.blob.size };
  }

  public async head(key: string): Promise<HeadResult | null> {
    const id = parseKey(key);
    if (id === null) {
      return null;
    }
    // size 取自 blob 行（权威），head 不读物理文件。
    const row = await this.db.object.findUnique({
      where: { id },
      include: { blob: { select: { size: true } } },
    });
    if (!row) {
      return null;
    }
    return { mime: row.mime, size: row.blob.size, sha256: row.sha256 };
  }

  /**
   * 控制台只读：分页列出对象（object ⋈ blob），按 id 倒序（最新在前）。可选 mime 精确过滤。
   * 读不走 writeLock（与 get/head 一致，读并发安全）。size/refcount 取自权威 blob 行。
   */
  public async list({
    page,
    pageSize,
    mime,
  }: {
    page: number;
    pageSize: number;
    mime?: string;
  }): Promise<ObjectListPage> {
    const where = mime ? { mime } : {};
    const offset = (page - 1) * pageSize;
    const [total, rows] = await Promise.all([
      this.db.object.count({ where }),
      this.db.object.findMany({
        where,
        include: { blob: { select: { size: true, sha256: true, refcount: true } } },
        orderBy: { id: "desc" },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const items: ObjectListRow[] = rows.map(row => ({
      id: row.id,
      mime: row.mime,
      createdAt: row.createdAt,
      size: row.blob.size,
      sha256: row.blob.sha256,
      refcount: row.blob.refcount,
    }));
    return { items, total };
  }

  /**
   * 控制台只读：存储统计。全表聚合（COUNT + SUM(int)，无 json_extract，成本远低于会撞网关超时的
   * 大表 json 聚合）；当前规模下远小于 gateway 30s 超时。读不走 writeLock。
   * logicalBytes（object ⋈ blob 求和）用 $queryRaw 一次算完，避免把全表行拉进进程再累加。
   */
  public async stats(): Promise<StorageStats> {
    const [objectCount, blobCount, physicalAgg, logicalRows] = await Promise.all([
      this.db.object.count(),
      this.db.blob.count(),
      this.db.blob.aggregate({ _sum: { size: true } }),
      this.db.$queryRaw<{ s: number }[]>`
        SELECT COALESCE(SUM(b.size), 0) AS s
        FROM object o JOIN blob b ON b.sha256 = o.sha256`,
    ]);
    return {
      objectCount,
      blobCount,
      physicalBytes: physicalAgg._sum.size ?? 0,
      logicalBytes: Number(logicalRows[0]?.s ?? 0),
    };
  }

  public async delete(key: string): Promise<boolean> {
    const id = parseKey(key);
    if (id === null) {
      return false;
    }

    // 写锁串行化：提交后 unlink 与并发 put 的 rename 不会交错（见类头"并发一致性"）。
    return this.writeLock.run(async () => {
      const outcome = await this.db.$transaction(async (tx): Promise<DeleteOutcome> => {
        const row = await tx.object.findUnique({ where: { id }, select: { sha256: true } });
        if (!row) {
          return { found: false, orphanSha256: null };
        }
        await tx.object.delete({ where: { id } });
        const blob = await tx.blob.findUnique({
          where: { sha256: row.sha256 },
          select: { refcount: true },
        });
        if (blob && blob.refcount <= 1) {
          await tx.blob.delete({ where: { sha256: row.sha256 } });
          return { found: true, orphanSha256: row.sha256 };
        }
        if (blob) {
          await tx.blob.update({
            where: { sha256: row.sha256 },
            data: { refcount: { decrement: 1 } },
          });
        }
        return { found: true, orphanSha256: null };
      });

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
        // 崩溃残留的临时写入文件（含 tmp/ 目录里的）也是孤儿；其余按库里有没有对应 blob 行判定。
        const blobRow = name.includes(".tmp-")
          ? null
          : await this.db.blob.findUnique({ where: { sha256: name }, select: { sha256: true } });
        const isOrphan = name.includes(".tmp-") || blobRow === null;
        if (!isOrphan) {
          continue;
        }
        try {
          await unlink(path.join(shardDir, name));
          removed += 1;
        } catch (error) {
          logger.errorWithCause("OSS sweep unlink failed", error, {
            event: "oss.sweep_unlink_failed",
            path: path.join(shard, name),
          });
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
      logger.errorWithCause("OSS unlink orphan blob failed", error, {
        event: "oss.unlink_orphan_failed",
        sha256,
      });
    }
  }
}

/** 由 object id 拼出对外 key（`res-<id>`）。与 {@link parseKey} 共享同一前缀，单一事实源。 */
export function formatObjectKey(id: number): string {
  return `${KEY_PREFIX}${id}`;
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
