import type { GbaButton } from "@kagami/gba-api/contract";
import type { EmulatorCore, GbaFrameRgba } from "../src/emulator/emulator-core.js";
import type { OssClient, OssObject } from "../src/acl/oss-client.js";
import type { GbaStore, ResumeStateRow, RomRow } from "../src/persistence/gba-store.js";
import { BizError } from "@kagami/kernel/errors/biz-error";

/** 确定性的假内核：记录每帧 held 集合，SRAM 是可注入的内存缓冲。 */
export class FakeEmulatorCore implements EmulatorCore {
  /** 每次 runFrame 的 held 快照（按序）。 */
  public readonly frames: Set<GbaButton>[] = [];
  public sram: Buffer | null = Buffer.alloc(128, 0);
  public shutdownCalled = false;
  public loadedRom: Buffer | null = null;
  /** 置 true 让 loadRom 抛错（坏 ROM / WASM 初始化失败）。 */
  public failLoad = false;
  /** 置 true 让下一次 runFrame 抛错一次（模拟 WASM trap）。 */
  public throwOnNextRunFrame = false;
  /** getState 返回的假快照；置 null 模拟核心不支持 savestate。 */
  public stateBlob: Buffer | null = Buffer.from("fake-savestate");
  /** setState 收到的字节（按序）。 */
  public readonly setStateCalls: Buffer[] = [];
  /** 置 true 让 setState 返回 false（核心校验不通过）。 */
  public failSetState = false;

  public async loadRom(rom: Buffer): Promise<void> {
    if (this.failLoad) {
      throw new Error("坏 ROM（测试）");
    }
    this.loadedRom = rom;
  }

  public runFrame(held: ReadonlySet<GbaButton>): void {
    if (this.throwOnNextRunFrame) {
      this.throwOnNextRunFrame = false;
      throw new Error("WASM trap（测试）");
    }
    this.frames.push(new Set(held));
  }

  public readFrameRgba(): GbaFrameRgba | null {
    return { width: 2, height: 2, pixels: new Uint8Array(16) };
  }

  public getSram(): Buffer | null {
    return this.sram ? Buffer.from(this.sram) : null;
  }

  public setSram(bytes: Buffer): void {
    if (this.sram) {
      bytes.copy(this.sram, 0, 0, Math.min(bytes.length, this.sram.length));
    }
  }

  public getState(): Buffer | null {
    return this.stateBlob ? Buffer.from(this.stateBlob) : null;
  }

  public setState(bytes: Buffer): boolean {
    this.setStateCalls.push(Buffer.from(bytes));
    return !this.failSetState;
  }

  public getFps(): number {
    return 60;
  }

  public async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }
}

/** 内存版 OSS：map 存字节。fail* 开关模拟不可达。 */
export class FakeOssClient implements OssClient {
  public readonly objects = new Map<string, Buffer>();
  public failGet = false;
  public failDelete = false;
  public deleted: string[] = [];
  private nextId = 1;

  public async putObject({ bytes }: { bytes: Buffer; mimeType: string }): Promise<string> {
    const key = `res-${this.nextId++}`;
    this.objects.set(key, Buffer.from(bytes));
    return key;
  }

  public async getObject(resId: string): Promise<OssObject> {
    if (this.failGet) {
      throw new BizError({ message: "OSS 不可达（测试）", meta: { reason: "OSS_GET_FAILED" } });
    }
    const bytes = this.objects.get(resId);
    if (!bytes) {
      throw new BizError({
        message: `OSS 对象不存在：${resId}`,
        meta: { reason: "OSS_OBJECT_NOT_FOUND" },
      });
    }
    return { bytes, mimeType: "application/octet-stream", size: bytes.length };
  }

  public async deleteObject(resId: string): Promise<void> {
    if (this.failDelete) {
      throw new BizError({
        message: "OSS 删除失败（测试）",
        meta: { reason: "OSS_DELETE_FAILED" },
      });
    }
    this.deleted.push(resId);
    this.objects.delete(resId);
  }
}

/** Prisma 的 UNIQUE 冲突（P2002）——让 GbaService.isUniqueConstraintError 走并发上传竞态分支。 */
function uniqueConstraintError(): Error {
  const error = new Error("Unique constraint failed（测试）") as Error & { code: string };
  error.code = "P2002";
  return error;
}

/**
 * 内存版 GbaStore：JS Map 承载，方法全异步（镜像 Prisma 的异步接口）。复刻真库的关键语义——
 * UNIQUE(name/sha256) 冲突抛 P2002、删 ROM 级联清电池存档 / 消费快照 + run_state 置 NULL、
 * run_state / resume_state 单行。单测只测纯逻辑、不碰真实 DB 引擎（GbaService 状态机的替身）。
 */
export class InMemoryGbaStore implements GbaStore {
  private readonly roms = new Map<
    number,
    {
      name: string;
      ossKey: string;
      sizeBytes: number;
      sha256: string;
      createdAt: number;
      lastPlayedAt: number | null;
    }
  >();
  private readonly batterySaves = new Map<number, Buffer>();
  private lastRomId: number | null = null;
  private resume: ResumeStateRow | null = null;
  private nextId = 1;

  public async listRoms(): Promise<RomRow[]> {
    return [...this.roms.keys()].sort((a, b) => b - a).map(id => this.buildRomRow(id));
  }

  public async getRom(id: number): Promise<RomRow | null> {
    return this.roms.has(id) ? this.buildRomRow(id) : null;
  }

  public async findRomBySha256(sha256: string): Promise<RomRow | null> {
    for (const [id, rom] of this.roms) {
      if (rom.sha256 === sha256) {
        return this.buildRomRow(id);
      }
    }
    return null;
  }

  public async findRomByName(name: string): Promise<RomRow | null> {
    for (const [id, rom] of this.roms) {
      if (rom.name === name) {
        return this.buildRomRow(id);
      }
    }
    return null;
  }

  public async insertRom(input: {
    name: string;
    ossKey: string;
    sizeBytes: number;
    sha256: string;
  }): Promise<RomRow> {
    for (const rom of this.roms.values()) {
      if (rom.name === input.name || rom.sha256 === input.sha256) {
        throw uniqueConstraintError();
      }
    }
    const id = this.nextId++;
    this.roms.set(id, { ...input, createdAt: Date.now(), lastPlayedAt: null });
    return this.buildRomRow(id);
  }

  public async deleteRom(id: number): Promise<boolean> {
    if (!this.roms.has(id)) {
      return false;
    }
    this.roms.delete(id);
    this.batterySaves.delete(id); // ON DELETE CASCADE
    if (this.lastRomId === id) {
      this.lastRomId = null; // ON DELETE SET NULL
    }
    if (this.resume?.romId === id) {
      this.resume = null; // ON DELETE CASCADE
    }
    return true;
  }

  public async touchLastPlayed(id: number): Promise<void> {
    const rom = this.roms.get(id);
    if (rom) {
      rom.lastPlayedAt = Date.now();
    }
  }

  public async getBatterySave(romId: number): Promise<Buffer | null> {
    const bytes = this.batterySaves.get(romId);
    return bytes ? Buffer.from(bytes) : null;
  }

  public async saveBatterySave(romId: number, bytes: Buffer): Promise<void> {
    this.batterySaves.set(romId, Buffer.from(bytes));
  }

  public async getLastRomId(): Promise<number | null> {
    return this.lastRomId;
  }

  public async setLastRomId(romId: number | null): Promise<void> {
    this.lastRomId = romId;
  }

  public async saveResumeState(input: {
    romId: number;
    savestate: Buffer;
    foreground: boolean;
    frame: number;
  }): Promise<void> {
    this.resume = {
      romId: input.romId,
      savestate: Buffer.from(input.savestate),
      foreground: input.foreground,
      frame: input.frame,
    };
  }

  public async getResumeState(): Promise<ResumeStateRow | null> {
    return this.resume ? { ...this.resume, savestate: Buffer.from(this.resume.savestate) } : null;
  }

  public async clearResumeState(): Promise<void> {
    this.resume = null;
  }

  private buildRomRow(id: number): RomRow {
    const rom = this.roms.get(id);
    if (!rom) {
      throw new Error(`[test] InMemoryGbaStore.buildRomRow 未找到 rom ${id}`);
    }
    return {
      id,
      name: rom.name,
      ossKey: rom.ossKey,
      sizeBytes: rom.sizeBytes,
      sha256: rom.sha256,
      createdAt: rom.createdAt,
      lastPlayedAt: rom.lastPlayedAt,
      hasSave: this.batterySaves.has(id),
    };
  }
}

export function createMemoryStore(): InMemoryGbaStore {
  return new InMemoryGbaStore();
}

/** 造一份最小合法 GBA ROM 字节（0xB2 处 0x96 固定值）。 */
export function fakeRomBytes(seed = 0): Buffer {
  const bytes = Buffer.alloc(512, seed);
  bytes[0xb2] = 0x96;
  return bytes;
}
