import { createHash } from "node:crypto";
import type { z } from "zod";
import type { GbaDeleteResultSchema, GbaUploadResultSchema } from "@kagami/gba-api/contract";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { OssClient } from "../acl/oss-client.js";
import type { GbaStore, RomRow } from "../persistence/gba-store.js";

type UploadResult = z.infer<typeof GbaUploadResultSchema>;
type DeleteResult = z.infer<typeof GbaDeleteResultSchema>;

/** GBA ROM 上限 32MB；OSS 侧与 body 上限取 40MB 留余量。 */
export const MAX_ROM_BYTES = 40 * 1024 * 1024;
/** GBA 卡带头固定校验字节（offset 0xB2 恒为 0x96），轻量甄别「根本不是 GBA ROM」的上传。 */
const GBA_HEADER_FIXED_OFFSET = 0xb2;
const GBA_HEADER_FIXED_VALUE = 0x96;
const MIN_ROM_BYTES = 192;

const logger = new AppLogger({ source: "gba-rom-library" });

type GbaRomLibraryDeps = {
  store: GbaStore;
  ossClient: OssClient;
};

/**
 * 卡带库（控制台管理面）：ROM 的增删查改。只与 store + OSS 打交道，**不碰模拟器核心**——
 * 「这颗 ROM 能不能删」这类会话态判断（正在加载 / 正被玩）留在 GbaService，由它调用前把关。
 */
export class GbaRomLibrary {
  private readonly store: GbaStore;
  private readonly ossClient: OssClient;

  public constructor({ store, ossClient }: GbaRomLibraryDeps) {
    this.store = store;
    this.ossClient = ossClient;
  }

  public async list(): Promise<RomRow[]> {
    return await this.store.listRoms();
  }

  public async upload(input: { name: string; bytes: Buffer }): Promise<UploadResult> {
    const name = input.name.trim();
    if (name.length === 0 || name.length > 200) {
      return { ok: false, reason: "INVALID_NAME" };
    }
    const { bytes } = input;
    if (bytes.length < MIN_ROM_BYTES || bytes.length > MAX_ROM_BYTES) {
      return { ok: false, reason: "INVALID_ROM_SIZE" };
    }
    // 轻量甄别：GBA 卡带头 0xB2 处恒为 0x96。不做深度格式解析。
    if (bytes[GBA_HEADER_FIXED_OFFSET] !== GBA_HEADER_FIXED_VALUE) {
      return { ok: false, reason: "NOT_A_GBA_ROM" };
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (await this.store.findRomBySha256(sha256)) {
      return { ok: false, reason: "DUPLICATE_ROM" };
    }
    if (await this.store.findRomByName(name)) {
      return { ok: false, reason: "DUPLICATE_NAME" };
    }
    const ossKey = await this.ossClient.putObject({
      bytes,
      mimeType: "application/octet-stream",
    });
    let rom: RomRow;
    try {
      rom = await this.store.insertRom({ name, ossKey, sizeBytes: bytes.length, sha256 });
    } catch (error) {
      // 并发上传竞态：两发都过了上面的同步去重检查、都传完 OSS，UNIQUE(sha256/name) 拦住后到者。
      // 归一为领域拒绝，并回收刚上传的孤儿 OSS 对象（失败仅告警，孤儿无害）。
      if (isUniqueConstraintError(error)) {
        await this.ossClient.deleteObject(ossKey).catch(() => {});
        logger.warn("GBA ROM 并发上传竞态，后到者按重复处理", {
          event: "gba.rom_upload_race",
          name,
          sha256,
        });
        return { ok: false, reason: "DUPLICATE_ROM" };
      }
      throw error;
    }
    logger.info("GBA ROM 入库", { event: "gba.rom_uploaded", romId: rom.id, name, sha256 });
    return { ok: true, rom: toRomView(rom) };
  }

  /**
   * 从 OSS 导入 ROM（#541 追加需求）：agent 侧只递 resId + name,字节由本服务从 OSS 拉回、
   * 走与 upload 完全相同的校验/去重/入库路径(重新 putObject 拿自有 key——OSS 内容寻址
   * 去重,相同字节零额外存储,且生命周期与来源对象解耦:来源被删不影响卡带库)。
   */
  public async importFromOss(input: { resId: string; name: string }): Promise<UploadResult> {
    let bytes: Buffer;
    try {
      const object = await this.ossClient.getObject(input.resId, { maxBytes: MAX_ROM_BYTES });
      bytes = object.bytes;
    } catch (error) {
      const reason = (error as { meta?: { reason?: string } }).meta?.reason;
      logger.warn("GBA 从 OSS 导入 ROM 拉取失败", {
        event: "gba.rom_import_fetch_failed",
        resId: input.resId,
        reason: reason ?? (error instanceof Error ? error.message : String(error)),
      });
      if (reason === "OSS_OBJECT_NOT_FOUND") {
        return { ok: false, reason: "SOURCE_NOT_FOUND" };
      }
      if (reason === "OSS_OBJECT_TOO_LARGE") {
        return { ok: false, reason: "SOURCE_TOO_LARGE" };
      }
      return { ok: false, reason: "SOURCE_FETCH_FAILED" };
    }
    return await this.upload({ name: input.name, bytes });
  }

  /**
   * 删除机制本身（调用方已完成会话态把关：加载中 / 正被玩一律先拒）。
   *
   * 删除一致性（issue #541 执行细则）：先删元数据行（battery_save 级联），后 best-effort 删
   * OSS 对象——失败仅告警，孤儿对象无害（OSS 有 refcount + 启动清扫）。
   */
  public async delete(romId: number): Promise<DeleteResult> {
    const rom = await this.store.getRom(romId);
    if (!rom) {
      return { ok: false, reason: "ROM_NOT_FOUND" };
    }
    await this.store.deleteRom(romId);
    try {
      await this.ossClient.deleteObject(rom.ossKey);
    } catch (error) {
      logger.errorWithCause("GBA 删除 OSS ROM 对象失败（孤儿无害，留待人工清理）", error, {
        event: "gba.rom_oss_delete_failed",
        romId,
        ossKey: rom.ossKey,
      });
    }
    logger.info("GBA ROM 删除", { event: "gba.rom_deleted", romId, name: rom.name });
    return { ok: true };
  }
}

/** Prisma 的 UNIQUE 约束冲突（P2002；并发上传竞态的判定依据）。 */
function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: unknown }).code === "P2002";
}

/** RomRow（存储层，ms 时间戳）→ 契约视图（ISO 字符串）。 */
export function toRomView(rom: RomRow): {
  id: number;
  name: string;
  sizeBytes: number;
  createdAt: string;
  lastPlayedAt: string | null;
  hasSave: boolean;
} {
  return {
    id: rom.id,
    name: rom.name,
    sizeBytes: rom.sizeBytes,
    createdAt: new Date(rom.createdAt).toISOString(),
    lastPlayedAt: rom.lastPlayedAt === null ? null : new Date(rom.lastPlayedAt).toISOString(),
    hasSave: rom.hasSave,
  };
}
