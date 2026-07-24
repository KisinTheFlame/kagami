import type { Database } from "../infra/db/client.js";

export interface RomRow {
  id: number;
  name: string;
  ossKey: string;
  sizeBytes: number;
  sha256: string;
  /** Unix ms。 */
  createdAt: number;
  /** Unix ms；从未加载过为 null。 */
  lastPlayedAt: number | null;
  hasSave: boolean;
}

export interface ResumeStateRow {
  romId: number;
  savestate: Buffer;
  foreground: boolean;
  frame: number;
}

/**
 * kagami-gba 元数据存储的端口。ROM 字节在 OSS（oss_key 引用），这里只存元数据 + 电池存档
 * （SRAM ≤128KB，BLOB 直接入库）+ 单行 run_state（重启恢复上次 ROM，冷启动语义）+ 单行
 * resume_state（优雅关停的无感重启现场）。方法全异步——底层 Prisma（better-sqlite3 adapter）
 * 一律异步；测试用 InMemoryGbaStore 实现同一接口。
 */
export interface GbaStore {
  listRoms(): Promise<RomRow[]>;
  getRom(id: number): Promise<RomRow | null>;
  findRomBySha256(sha256: string): Promise<RomRow | null>;
  findRomByName(name: string): Promise<RomRow | null>;
  insertRom(input: {
    name: string;
    ossKey: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<RomRow>;
  /** 删除 ROM 行（battery_save / resume_state 级联删除、run_state.rom_id 置 NULL）。返回是否删到行。 */
  deleteRom(id: number): Promise<boolean>;
  touchLastPlayed(id: number): Promise<void>;
  getBatterySave(romId: number): Promise<Buffer | null>;
  saveBatterySave(romId: number, bytes: Buffer): Promise<void>;
  /** 重启恢复：上次加载的 ROM id（无则 null）。 */
  getLastRomId(): Promise<number | null>;
  setLastRomId(romId: number | null): Promise<void>;
  saveResumeState(input: {
    romId: number;
    savestate: Buffer;
    foreground: boolean;
    frame: number;
  }): Promise<void>;
  getResumeState(): Promise<ResumeStateRow | null>;
  clearResumeState(): Promise<void>;
}

/** Prisma 关系 include 出来的最小 rom 投影（+ battery_save 是否存在）。 */
type RomWithSave = {
  id: number;
  name: string;
  ossKey: string;
  sizeBytes: number;
  sha256: string;
  createdAt: number;
  lastPlayedAt: number | null;
  batterySave: { romId: number } | null;
};

const SELECT_HAS_SAVE = { batterySave: { select: { romId: true } } } as const;

/**
 * kagami-gba 的元数据库（Prisma，better-sqlite3 adapter）。schema 由 prisma/migrations 拥有，
 * 进程只连不建表。级联删除 / 单行 upsert 语义见各方法注释。
 */
export class PrismaGbaStore implements GbaStore {
  private readonly db: Database;

  public constructor({ db }: { db: Database }) {
    this.db = db;
  }

  public async listRoms(): Promise<RomRow[]> {
    const rows = await this.db.rom.findMany({
      orderBy: { id: "desc" },
      include: SELECT_HAS_SAVE,
    });
    return rows.map(toRomRow);
  }

  public async getRom(id: number): Promise<RomRow | null> {
    const row = await this.db.rom.findUnique({ where: { id }, include: SELECT_HAS_SAVE });
    return row ? toRomRow(row) : null;
  }

  public async findRomBySha256(sha256: string): Promise<RomRow | null> {
    const row = await this.db.rom.findUnique({ where: { sha256 }, include: SELECT_HAS_SAVE });
    return row ? toRomRow(row) : null;
  }

  public async findRomByName(name: string): Promise<RomRow | null> {
    const row = await this.db.rom.findUnique({ where: { name }, include: SELECT_HAS_SAVE });
    return row ? toRomRow(row) : null;
  }

  public async insertRom(input: {
    name: string;
    ossKey: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<RomRow> {
    const row = await this.db.rom.create({
      data: {
        name: input.name,
        ossKey: input.ossKey,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        createdAt: Date.now(),
      },
      include: SELECT_HAS_SAVE,
    });
    return toRomRow(row);
  }

  public async deleteRom(id: number): Promise<boolean> {
    // deleteMany（缺行返回 count=0，不抛 P2025）；battery_save / resume_state 经 DB 级
    // ON DELETE CASCADE 连带删除、run_state.rom_id 经 ON DELETE SET NULL 置空
    //（依赖 configureSqlite 的 PRAGMA foreign_keys = ON）。
    const result = await this.db.rom.deleteMany({ where: { id } });
    return result.count > 0;
  }

  public async touchLastPlayed(id: number): Promise<void> {
    await this.db.rom.update({ where: { id }, data: { lastPlayedAt: Date.now() } });
  }

  public async getBatterySave(romId: number): Promise<Buffer | null> {
    const row = await this.db.batterySave.findUnique({
      where: { romId },
      select: { bytes: true },
    });
    return row ? Buffer.from(row.bytes) : null;
  }

  public async saveBatterySave(romId: number, bytes: Buffer): Promise<void> {
    const now = Date.now();
    const blob = toPrismaBytes(bytes);
    await this.db.batterySave.upsert({
      where: { romId },
      create: { romId, bytes: blob, updatedAt: now },
      update: { bytes: blob, updatedAt: now },
    });
  }

  public async getLastRomId(): Promise<number | null> {
    const row = await this.db.runState.findUnique({ where: { id: 1 }, select: { romId: true } });
    return row?.romId ?? null;
  }

  public async setLastRomId(romId: number | null): Promise<void> {
    await this.db.runState.upsert({
      where: { id: 1 },
      create: { id: 1, romId },
      update: { romId },
    });
  }

  /**
   * 无感重启快照（单行 id=1）：只在优雅关停时写入、只在紧随其后的启动里恢复一次。
   * crash（非优雅退出）不写快照——落回「断电 + 电池存档」的真机语义。
   */
  public async saveResumeState(input: {
    romId: number;
    savestate: Buffer;
    foreground: boolean;
    frame: number;
  }): Promise<void> {
    const data = {
      romId: input.romId,
      savestate: toPrismaBytes(input.savestate),
      foreground: input.foreground,
      frame: input.frame,
      savedAt: Date.now(),
    };
    await this.db.resumeState.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
  }

  public async getResumeState(): Promise<ResumeStateRow | null> {
    const row = await this.db.resumeState.findUnique({ where: { id: 1 } });
    if (!row) {
      return null;
    }
    return {
      romId: row.romId,
      savestate: Buffer.from(row.savestate),
      foreground: row.foreground,
      frame: row.frame,
    };
  }

  /** 快照消费即删：恢复尝试过（无论成败）就清掉，绝不让陈旧快照在多次重启后复活。 */
  public async clearResumeState(): Promise<void> {
    await this.db.resumeState.deleteMany({ where: { id: 1 } });
  }
}

function toRomRow(row: RomWithSave): RomRow {
  return {
    id: row.id,
    name: row.name,
    ossKey: row.ossKey,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    createdAt: row.createdAt,
    lastPlayedAt: row.lastPlayedAt,
    hasSave: row.batterySave !== null,
  };
}

/**
 * Buffer → Prisma `Bytes` 入参。Prisma 7 的 Bytes 输入类型是 `Uint8Array<ArrayBuffer>`，
 * 而 @types/node 的 `Buffer<ArrayBufferLike>`（含 `Uint8Array.from` 的推断结果）都带
 * `ArrayBufferLike` 型参、不能直接赋（SharedArrayBuffer 分支不兼容）。拷进一块新分配的
 * `Uint8Array<ArrayBuffer>`（SRAM ≤128KB / savestate 都很小，拷贝无碍）。
 */
function toPrismaBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy;
}
