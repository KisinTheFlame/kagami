import type Database from "better-sqlite3";

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

interface RawRomRow {
  id: number;
  name: string;
  oss_key: string;
  size_bytes: number;
  sha256: string;
  created_at: number;
  last_played_at: number | null;
  has_save: number;
}

/**
 * kagami-gba 的元数据库（裸 better-sqlite3，镜像 OSS 的 init 模式：启动时幂等建表 + PRAGMA，
 * 无 Prisma / 无 migration 框架）。ROM 字节在 OSS（oss_key 引用），这里只存元数据 + 电池存档
 * （SRAM ≤128KB，BLOB 直接入库）+ 单行 run_state（重启恢复上次 ROM，冷启动语义）。
 */
export class GbaStore {
  private readonly db: Database.Database;

  public constructor({ db }: { db: Database.Database }) {
    this.db = db;
    this.applySchema();
  }

  /** 启动时幂等建表 + PRAGMA。裸 better-sqlite3 不显式开 FK 则 REFERENCES 形同虚设。 */
  private applySchema(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rom (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL UNIQUE,
        oss_key        TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL,
        sha256         TEXT NOT NULL UNIQUE,
        created_at     INTEGER NOT NULL,
        last_played_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS battery_save (
        rom_id     INTEGER PRIMARY KEY REFERENCES rom(id) ON DELETE CASCADE,
        bytes      BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_state (
        id     INTEGER PRIMARY KEY CHECK (id = 1),
        rom_id INTEGER REFERENCES rom(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS resume_state (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        rom_id     INTEGER NOT NULL REFERENCES rom(id) ON DELETE CASCADE,
        savestate  BLOB NOT NULL,
        foreground INTEGER NOT NULL,
        frame      INTEGER NOT NULL,
        saved_at   INTEGER NOT NULL
      );
    `);
  }

  public listRoms(): RomRow[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.name, r.oss_key, r.size_bytes, r.sha256, r.created_at, r.last_played_at,
                EXISTS(SELECT 1 FROM battery_save b WHERE b.rom_id = r.id) AS has_save
         FROM rom r ORDER BY r.id DESC`,
      )
      .all() as RawRomRow[];
    return rows.map(toRomRow);
  }

  public getRom(id: number): RomRow | null {
    const row = this.db.prepare(`${SELECT_ROM} WHERE r.id = ?`).get(id) as RawRomRow | undefined;
    return row ? toRomRow(row) : null;
  }

  public findRomBySha256(sha256: string): RomRow | null {
    const row = this.db.prepare(`${SELECT_ROM} WHERE r.sha256 = ?`).get(sha256) as
      | RawRomRow
      | undefined;
    return row ? toRomRow(row) : null;
  }

  public findRomByName(name: string): RomRow | null {
    const row = this.db.prepare(`${SELECT_ROM} WHERE r.name = ?`).get(name) as
      | RawRomRow
      | undefined;
    return row ? toRomRow(row) : null;
  }

  public insertRom(input: {
    name: string;
    ossKey: string;
    sizeBytes: number;
    sha256: string;
  }): RomRow {
    const info = this.db
      .prepare(
        `INSERT INTO rom (name, oss_key, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.name, input.ossKey, input.sizeBytes, input.sha256, Date.now());
    const rom = this.getRom(Number(info.lastInsertRowid));
    if (!rom) {
      throw new Error("[gba] insertRom 后读回失败（不应发生）");
    }
    return rom;
  }

  /** 删除 ROM 行（battery_save 级联删除、run_state.rom_id 置 NULL）。 */
  public deleteRom(id: number): boolean {
    const info = this.db.prepare(`DELETE FROM rom WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  public touchLastPlayed(id: number): void {
    this.db.prepare(`UPDATE rom SET last_played_at = ? WHERE id = ?`).run(Date.now(), id);
  }

  public getBatterySave(romId: number): Buffer | null {
    const row = this.db.prepare(`SELECT bytes FROM battery_save WHERE rom_id = ?`).get(romId) as
      | { bytes: Buffer }
      | undefined;
    return row ? row.bytes : null;
  }

  public saveBatterySave(romId: number, bytes: Buffer): void {
    this.db
      .prepare(
        `INSERT INTO battery_save (rom_id, bytes, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(rom_id) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at`,
      )
      .run(romId, bytes, Date.now());
  }

  /** 重启恢复：上次加载的 ROM id（无则 null）。 */
  public getLastRomId(): number | null {
    const row = this.db.prepare(`SELECT rom_id FROM run_state WHERE id = 1`).get() as
      | { rom_id: number | null }
      | undefined;
    return row?.rom_id ?? null;
  }

  public setLastRomId(romId: number | null): void {
    this.db
      .prepare(
        `INSERT INTO run_state (id, rom_id) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET rom_id = excluded.rom_id`,
      )
      .run(romId);
  }

  /**
   * 无感重启快照（单行）：只在优雅关停时写入、只在紧随其后的启动里恢复一次。
   * crash（非优雅退出）不写快照——落回「断电 + 电池存档」的真机语义。
   */
  public saveResumeState(input: {
    romId: number;
    savestate: Buffer;
    foreground: boolean;
    frame: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO resume_state (id, rom_id, savestate, foreground, frame, saved_at)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET rom_id = excluded.rom_id, savestate = excluded.savestate,
           foreground = excluded.foreground, frame = excluded.frame, saved_at = excluded.saved_at`,
      )
      .run(input.romId, input.savestate, input.foreground ? 1 : 0, input.frame, Date.now());
  }

  public getResumeState(): ResumeStateRow | null {
    const row = this.db
      .prepare(`SELECT rom_id, savestate, foreground, frame FROM resume_state WHERE id = 1`)
      .get() as
      | { rom_id: number; savestate: Buffer; foreground: number; frame: number }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      romId: row.rom_id,
      savestate: row.savestate,
      foreground: row.foreground === 1,
      frame: row.frame,
    };
  }

  /** 快照消费即删：恢复尝试过（无论成败）就清掉，绝不让陈旧快照在多次重启后复活。 */
  public clearResumeState(): void {
    this.db.prepare(`DELETE FROM resume_state WHERE id = 1`).run();
  }
}

export interface ResumeStateRow {
  romId: number;
  savestate: Buffer;
  foreground: boolean;
  frame: number;
}

const SELECT_ROM = `
  SELECT r.id, r.name, r.oss_key, r.size_bytes, r.sha256, r.created_at, r.last_played_at,
         EXISTS(SELECT 1 FROM battery_save b WHERE b.rom_id = r.id) AS has_save
  FROM rom r`;

function toRomRow(row: RawRomRow): RomRow {
  return {
    id: row.id,
    name: row.name,
    ossKey: row.oss_key,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
    lastPlayedAt: row.last_played_at,
    hasSave: row.has_save === 1,
  };
}
