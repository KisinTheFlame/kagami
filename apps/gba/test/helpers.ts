import Database from "better-sqlite3";
import type { GbaButton } from "@kagami/gba-api/contract";
import type { EmulatorCore, GbaFrameRgba } from "../src/emulator/emulator-core.js";
import type { OssClient, OssObject } from "../src/acl/oss-client.js";
import { GbaStore } from "../src/persistence/gba-store.js";
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

export function createMemoryStore(): GbaStore {
  return new GbaStore({ db: new Database(":memory:") });
}

/** 造一份最小合法 GBA ROM 字节（0xB2 处 0x96 固定值）。 */
export function fakeRomBytes(seed = 0): Buffer {
  const bytes = Buffer.alloc(512, seed);
  bytes[0xb2] = 0x96;
  return bytes;
}
