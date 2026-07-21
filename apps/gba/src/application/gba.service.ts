import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  GbaButton,
  GbaDeleteResultSchema,
  GbaLoadResultSchema,
  GbaPressResultSchema,
  GbaPressStepSchema,
  GbaRunStateSchema,
  GbaScreenshotResultSchema,
  GbaUploadResultSchema,
} from "@kagami/gba-api/contract";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { EmulatorCore, EmulatorCoreFactory } from "../emulator/emulator-core.js";
import { encodeFramePng } from "../emulator/frame-png.js";
import type { OssClient } from "../acl/oss-client.js";
import type { GbaStore, RomRow } from "../persistence/gba-store.js";

type PressResult = z.infer<typeof GbaPressResultSchema>;
type ScreenshotResult = z.infer<typeof GbaScreenshotResultSchema>;
type LoadResult = z.infer<typeof GbaLoadResultSchema>;
type UploadResult = z.infer<typeof GbaUploadResultSchema>;
type DeleteResult = z.infer<typeof GbaDeleteResultSchema>;
type RunState = z.infer<typeof GbaRunStateSchema>;
type PressStep = z.infer<typeof GbaPressStepSchema>;

// === press 领域上限（超限回 { ok:false, reason }，不是 HTTP 400——镜像 spire「引擎拒绝不是
// 服务故障」；数值定稿于 issue #541 的 Codex 咨询）===
const MAX_CHORD_BUTTONS = 4;
const MAX_HOLD_FRAMES = 120;
const MAX_GAP_FRAMES = 30;
const MAX_SETTLE_FRAMES = 120;
const MAX_STEPS = 8;
/** 单请求总帧预算：Σ每步(hold+gap) + settle ≤ 300（实速 ~5s）。 */
const MAX_TOTAL_FRAMES = 300;

/** 前台空闲看门狗：超时自动转后台 + flush 存档（防 agent 崩溃后模拟器空转）。 */
const WATCHDOG_IDLE_MS = 10 * 60 * 1000;
/** SRAM 周期脏检查间隔。 */
const SRAM_FLUSH_INTERVAL_MS = 30 * 1000;
/** 单 tick 追帧上限：吸收计时器抖动，绝不成为快进通道。 */
const MAX_CATCHUP_FRAMES_PER_TICK = 4;
/** 落后超此值（事件循环卡顿）就丢帧重新对齐——宁可丢帧，绝不快进补作业。 */
const RESYNC_THRESHOLD_MS = 250;

/** GBA ROM 上限 32MB；OSS 侧与 body 上限取 40MB 留余量。 */
export const MAX_ROM_BYTES = 40 * 1024 * 1024;
/** GBA 卡带头固定校验字节（offset 0xB2 恒为 0x96），轻量甄别「根本不是 GBA ROM」的上传。 */
const GBA_HEADER_FIXED_OFFSET = 0xb2;
const GBA_HEADER_FIXED_VALUE = 0x96;
const MIN_ROM_BYTES = 192;

const EMPTY_HELD: ReadonlySet<GbaButton> = new Set();

const logger = new AppLogger({ source: "gba-service" });

/** 活动中的 press 计划：每帧一个 held 集合，由帧循环逐帧消费。 */
type PressPlan = {
  frames: ReadonlySet<GbaButton>[];
  cursor: number;
  startFrame: number;
  /** frames 中「最后一个非 settle 帧」的下标 + 1（= 松键时刻）。 */
  releaseOffset: number;
  resolve: (result: PressResult) => void;
};

type GbaServiceDeps = {
  store: GbaStore;
  ossClient: OssClient;
  coreFactory: EmulatorCoreFactory;
  /** 测试注入的时钟；默认 Date.now。 */
  now?: () => number;
  /** 看门狗空闲窗口；默认 10 分钟。测试注入短窗口避免假时钟推几万个 tick。 */
  watchdogIdleMs?: number;
};

/**
 * kagami-gba 的领域服务：模拟器会话状态机。运行模型（issue #541 硬约束）——
 *
 * - 前台 = 实时运行：内部帧循环以核心标称速率（59.7275fps）推进，漂移校正但**绝不快进**
 *   （落后先限量追帧、超阈值直接丢帧对齐）。后台 = 冻结（循环停止，先 flush 电池存档）。
 * - **帧推进权唯一归属帧循环**：press 只把「未来 N 帧的按键计划」写进 plan，由循环逐帧消费,
 *   消费完毕 + settle 走完后采帧回图。天然无重复推进 / 竞态；并发 press 直接拒绝。
 * - 按键状态完全由活动 plan 派生（无 plan = 全松开）：任何路径清掉 plan 即等价「finally 清键」，
 *   不存在方向键卡死的状态残留。
 * - 电池存档：SRAM 周期脏检查（hash 对比）+ blur / 换 ROM / 关停时强制 flush；重启 = 关机重开
 *   （恢复上次 ROM + 存档，冷启动、处于后台，未记录的进度像真机断电一样丢失）。
 */
export class GbaService {
  private readonly store: GbaStore;
  private readonly ossClient: OssClient;
  private readonly coreFactory: EmulatorCoreFactory;
  private readonly now: () => number;
  private readonly watchdogIdleMs: number;

  private core: EmulatorCore | null = null;
  private romId: number | null = null;
  private romName: string | null = null;
  private timelineId: string | null = null;
  private frame = 0;
  private foreground = false;
  private plan: PressPlan | null = null;

  private timer: NodeJS.Timeout | null = null;
  private nextFrameAt = 0;
  private lastActivityAt = 0;
  private lastSramFlushAt = 0;
  private lastSramHash: string | null = null;

  public constructor({ store, ossClient, coreFactory, now, watchdogIdleMs }: GbaServiceDeps) {
    this.store = store;
    this.ossClient = ossClient;
    this.coreFactory = coreFactory;
    // 晚绑定：测试用 vi.useFakeTimers 替换全局 Date 时，这里才能取到假时钟。
    this.now = now ?? ((): number => Date.now());
    this.watchdogIdleMs = watchdogIdleMs ?? WATCHDOG_IDLE_MS;
  }

  /**
   * 启动恢复：上次加载的 ROM 冷启动回来（后台、注入电池存档）。OSS 不可达 / ROM 已删时
   * 跳过并告警——服务必须能空手起来，恢复失败不是启动失败。
   */
  public async init(): Promise<void> {
    const lastRomId = this.store.getLastRomId();
    if (lastRomId === null) {
      return;
    }
    const result = await this.loadGame(lastRomId);
    if (!result.ok) {
      logger.warn("GBA 启动恢复上次 ROM 失败，跳过", {
        event: "gba.restore_last_rom_failed",
        romId: lastRomId,
        reason: result.reason,
      });
    }
  }

  public state(): RunState {
    return {
      loaded: this.core !== null,
      romId: this.romId,
      romName: this.romName,
      foreground: this.foreground,
      frame: this.frame,
      timelineId: this.timelineId,
    };
  }

  /**
   * 前后台切换（App onFocus/onBlur）。转后台先中止在途 press、flush 电池存档再冻结——
   * flush 失败向上抛（HTTP 500），这是服务故障不是领域拒绝。
   */
  public setForeground(focused: boolean): { foreground: boolean } {
    if (focused === this.foreground) {
      return { foreground: this.foreground };
    }
    if (focused) {
      this.foreground = true;
      this.touchActivity();
      if (this.core) {
        this.startLoop();
      }
      logger.info("GBA 转前台（实时运行）", { event: "gba.foreground", romId: this.romId });
      return { foreground: true };
    }
    this.abortPlan("GBA_NOT_FOREGROUND: 执行中被切到后台，按键已全部松开");
    this.stopLoop();
    this.foreground = false;
    this.flushSramIfDirty();
    logger.info("GBA 转后台（冻结）", { event: "gba.background", romId: this.romId });
    return { foreground: false };
  }

  public async loadGame(romId: number): Promise<LoadResult> {
    this.touchActivity();
    const rom = this.store.getRom(romId);
    if (!rom) {
      return { ok: false, reason: "ROM_NOT_FOUND" };
    }

    // 换 ROM 顺序（issue #541 执行细则）：先 flush 当前 SRAM（失败拒绝加载），再卸载旧核心。
    if (this.core) {
      try {
        this.flushSramIfDirty();
      } catch (error) {
        logger.errorWithCause("GBA 换 ROM 前 flush 存档失败，拒绝加载", error, {
          event: "gba.load_flush_failed",
          fromRomId: this.romId,
          toRomId: romId,
        });
        return { ok: false, reason: "SRAM_FLUSH_FAILED" };
      }
      this.abortPlan("GBA_GAME_UNLOADED: 游戏被切换，按键已全部松开");
      this.stopLoop();
      const old = this.core;
      this.core = null;
      await old.shutdown();
    }

    let bytes: Buffer;
    try {
      const object = await this.ossClient.getObject(rom.ossKey, { maxBytes: MAX_ROM_BYTES });
      bytes = object.bytes;
    } catch (error) {
      logger.errorWithCause("GBA 从 OSS 拉取 ROM 失败", error, {
        event: "gba.rom_fetch_failed",
        romId,
        ossKey: rom.ossKey,
      });
      return { ok: false, reason: "ROM_FETCH_FAILED" };
    }

    const core = this.coreFactory();
    await core.loadRom(bytes);
    const save = this.store.getBatterySave(romId);
    if (save) {
      core.setSram(save);
    }

    this.core = core;
    this.romId = romId;
    this.romName = rom.name;
    this.timelineId = `gba-${this.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    this.frame = 0;
    // 冷启动推进一帧：让 screenshot 立即有帧可看（后台加载也只多这一帧，无实时性影响）。
    core.runFrame(EMPTY_HELD);
    this.frame = 1;
    this.lastSramHash = this.hashSram();
    this.lastSramFlushAt = this.now();

    this.store.touchLastPlayed(romId);
    this.store.setLastRomId(romId);
    if (this.foreground) {
      this.startLoop();
    }
    logger.info("GBA 加载 ROM", { event: "gba.load_game", romId, romName: rom.name });
    return { ok: true, romId, romName: rom.name, timelineId: this.timelineId };
  }

  /** press 工具的平铺形态：单 chord = 单步序列的语法糖，同一条执行路径。 */
  public press(input: {
    buttons: GbaButton[];
    holdFrames: number;
    settleFrames: number;
  }): Promise<PressResult> {
    return this.pressSequence({
      steps: [{ buttons: input.buttons, holdFrames: input.holdFrames, gapFrames: 1 }],
      settleFrames: input.settleFrames,
    });
  }

  public pressSequence(input: { steps: PressStep[]; settleFrames: number }): Promise<PressResult> {
    this.touchActivity();
    if (!this.core) {
      return Promise.resolve({ ok: false, reason: "NO_GAME_LOADED" });
    }
    if (!this.foreground) {
      return Promise.resolve({ ok: false, reason: "GBA_NOT_FOREGROUND" });
    }
    if (this.plan) {
      return Promise.resolve({ ok: false, reason: "PRESS_IN_PROGRESS" });
    }

    const built = buildPressPlan(input.steps, input.settleFrames);
    if (typeof built === "string") {
      return Promise.resolve({ ok: false, reason: built });
    }

    return new Promise<PressResult>(resolve => {
      this.plan = {
        frames: built.frames,
        cursor: 0,
        startFrame: this.frame,
        releaseOffset: built.releaseOffset,
        resolve,
      };
    });
  }

  public screenshot(): ScreenshotResult {
    this.touchActivity();
    if (!this.core || this.timelineId === null) {
      return { ok: false, reason: "NO_GAME_LOADED" };
    }
    const frame = this.core.readFrameRgba();
    if (!frame) {
      return { ok: false, reason: "NO_FRAME_AVAILABLE" };
    }
    return {
      ok: true,
      timelineId: this.timelineId,
      capturedFrame: this.frame,
      imageBase64: encodeFramePng(frame).toString("base64"),
    };
  }

  // === ROM 库（控制台管理面）===

  public listRoms(): RomRow[] {
    return this.store.listRoms();
  }

  public async uploadRom(input: { name: string; bytes: Buffer }): Promise<UploadResult> {
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
    if (this.store.findRomBySha256(sha256)) {
      return { ok: false, reason: "DUPLICATE_ROM" };
    }
    if (this.store.findRomByName(name)) {
      return { ok: false, reason: "DUPLICATE_NAME" };
    }
    const ossKey = await this.ossClient.putObject({
      bytes,
      mimeType: "application/octet-stream",
    });
    const rom = this.store.insertRom({ name, ossKey, sizeBytes: bytes.length, sha256 });
    logger.info("GBA ROM 入库", { event: "gba.rom_uploaded", romId: rom.id, name, sha256 });
    return { ok: true, rom: toRomView(rom) };
  }

  public async deleteRom(romId: number): Promise<DeleteResult> {
    if (romId === this.romId && this.core) {
      return { ok: false, reason: "ROM_LOADED" };
    }
    const rom = this.store.getRom(romId);
    if (!rom) {
      return { ok: false, reason: "ROM_NOT_FOUND" };
    }
    // 删除一致性（issue #541 执行细则）：先删元数据行（battery_save 级联），后 best-effort 删
    // OSS 对象——失败仅告警，孤儿对象无害（OSS 有 refcount + 启动清扫）。
    this.store.deleteRom(romId);
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

  /** 关停：中止在途 press、冻结、best-effort flush 存档、释放核心。 */
  public async shutdown(): Promise<void> {
    this.abortPlan("GBA_SHUTTING_DOWN: 服务关停，按键已全部松开");
    this.stopLoop();
    this.foreground = false;
    try {
      this.flushSramIfDirty();
    } catch (error) {
      logger.errorWithCause("GBA 关停 flush 存档失败", error, {
        event: "gba.shutdown_flush_failed",
        romId: this.romId,
      });
    }
    const core = this.core;
    this.core = null;
    if (core) {
      await core.shutdown();
    }
  }

  // === 帧循环（帧推进权唯一归属处）===

  private startLoop(): void {
    if (this.timer !== null) {
      return;
    }
    this.nextFrameAt = this.now();
    this.scheduleNextTick();
  }

  private stopLoop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(): void {
    const delay = Math.max(0, this.nextFrameAt - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.tick();
    }, delay);
  }

  private tick(): void {
    const core = this.core;
    if (!this.foreground || !core) {
      return;
    }
    const frameMs = 1000 / core.getFps();
    const t = this.now();

    // 事件循环卡顿（GC / 同步大任务）落后超阈值：丢帧重新对齐。宁可时间少流逝，绝不快进补作业。
    if (t - this.nextFrameAt > RESYNC_THRESHOLD_MS) {
      this.nextFrameAt = t;
    }
    let ran = 0;
    while (this.now() >= this.nextFrameAt && ran < MAX_CATCHUP_FRAMES_PER_TICK) {
      this.runOneFrame(core);
      this.nextFrameAt += frameMs;
      ran += 1;
    }

    // 看门狗：前台空闲超时自动转后台（内含 flush；失败仅告警，周期 flush 会重试）。
    if (this.now() - this.lastActivityAt > this.watchdogIdleMs) {
      logger.info("GBA 前台空闲超时，看门狗自动转后台", { event: "gba.watchdog_background" });
      try {
        this.setForeground(false);
      } catch (error) {
        logger.errorWithCause("GBA 看门狗转后台失败", error, { event: "gba.watchdog_failed" });
      }
      return;
    }
    // SRAM 周期脏检查。
    if (this.now() - this.lastSramFlushAt > SRAM_FLUSH_INTERVAL_MS) {
      this.lastSramFlushAt = this.now();
      try {
        this.flushSramIfDirty();
      } catch (error) {
        logger.errorWithCause("GBA 周期 flush 存档失败（下轮重试）", error, {
          event: "gba.periodic_flush_failed",
        });
      }
    }
    this.scheduleNextTick();
  }

  private runOneFrame(core: EmulatorCore): void {
    const plan = this.plan;
    const held = plan ? (plan.frames[plan.cursor] ?? EMPTY_HELD) : EMPTY_HELD;
    core.runFrame(held);
    this.frame += 1;
    if (!plan) {
      return;
    }
    plan.cursor += 1;
    if (plan.cursor >= plan.frames.length) {
      this.completePlan(plan, core);
    }
  }

  /** 计划走完：采帧回图。plan 置空即「全部松开」——按键状态完全由 plan 派生。 */
  private completePlan(plan: PressPlan, core: EmulatorCore): void {
    this.plan = null;
    const frame = core.readFrameRgba();
    if (!frame || this.timelineId === null) {
      plan.resolve({ ok: false, reason: "NO_FRAME_AVAILABLE" });
      return;
    }
    plan.resolve({
      ok: true,
      timelineId: this.timelineId,
      startFrame: plan.startFrame,
      releasedFrame: plan.startFrame + plan.releaseOffset,
      capturedFrame: this.frame,
      imageBase64: encodeFramePng(frame).toString("base64"),
    });
  }

  /** 中止在途 press（切后台 / 换 ROM / 关停）：plan 置空 = 按键全松开，调用方拿到领域拒绝。 */
  private abortPlan(reason: string): void {
    const plan = this.plan;
    if (!plan) {
      return;
    }
    this.plan = null;
    plan.resolve({ ok: false, reason });
  }

  // === 电池存档 ===

  /** SRAM 脏检查 + 落库。失败向上抛，由调用方决定语义（blur/换 ROM 硬失败，周期/关停仅告警）。 */
  private flushSramIfDirty(): void {
    if (!this.core || this.romId === null) {
      return;
    }
    const sram = this.core.getSram();
    if (!sram || sram.length === 0) {
      return;
    }
    const hash = createHash("sha256").update(sram).digest("hex");
    if (hash === this.lastSramHash) {
      return;
    }
    this.store.saveBatterySave(this.romId, sram);
    this.lastSramHash = hash;
    logger.info("GBA 电池存档落库", {
      event: "gba.sram_flushed",
      romId: this.romId,
      bytes: sram.length,
    });
  }

  private hashSram(): string | null {
    const sram = this.core?.getSram();
    if (!sram || sram.length === 0) {
      return null;
    }
    return createHash("sha256").update(sram).digest("hex");
  }

  private touchActivity(): void {
    this.lastActivityAt = this.now();
  }
}

/**
 * 把 press 序列展开成逐帧按键计划。领域校验失败返回 reason 字符串（`{ ok:false }` 语义），
 * 通过则返回 frames（每帧一个 held 集合）+ releaseOffset（松键时刻，供时间线元数据）。
 */
function buildPressPlan(
  steps: PressStep[],
  settleFrames: number,
): { frames: ReadonlySet<GbaButton>[]; releaseOffset: number } | string {
  if (steps.length > MAX_STEPS) {
    return `INVALID_PRESS: steps 数量 ${steps.length} 超上限 ${MAX_STEPS}`;
  }
  if (settleFrames > MAX_SETTLE_FRAMES) {
    return `INVALID_PRESS: settleFrames ${settleFrames} 超上限 ${MAX_SETTLE_FRAMES}`;
  }
  const frames: ReadonlySet<GbaButton>[] = [];
  for (const [index, step] of steps.entries()) {
    const buttons = new Set(step.buttons);
    if (buttons.size !== step.buttons.length) {
      return `INVALID_PRESS: 第 ${index + 1} 步 buttons 含重复键`;
    }
    if (buttons.size > MAX_CHORD_BUTTONS) {
      return `INVALID_PRESS: 第 ${index + 1} 步同时按 ${buttons.size} 键，超上限 ${MAX_CHORD_BUTTONS}`;
    }
    if (buttons.has("up") && buttons.has("down")) {
      return `INVALID_PRESS: 第 ${index + 1} 步同时按 up+down（物理不可能的互斥方向）`;
    }
    if (buttons.has("left") && buttons.has("right")) {
      return `INVALID_PRESS: 第 ${index + 1} 步同时按 left+right（物理不可能的互斥方向）`;
    }
    if (step.holdFrames > MAX_HOLD_FRAMES) {
      return `INVALID_PRESS: 第 ${index + 1} 步 holdFrames ${step.holdFrames} 超上限 ${MAX_HOLD_FRAMES}`;
    }
    if (step.gapFrames > MAX_GAP_FRAMES) {
      return `INVALID_PRESS: 第 ${index + 1} 步 gapFrames ${step.gapFrames} 超上限 ${MAX_GAP_FRAMES}`;
    }
    const chord: ReadonlySet<GbaButton> = buttons;
    for (let i = 0; i < step.holdFrames; i++) {
      frames.push(chord);
    }
    for (let i = 0; i < step.gapFrames; i++) {
      frames.push(EMPTY_HELD);
    }
  }
  const releaseOffset = frames.length;
  for (let i = 0; i < settleFrames; i++) {
    frames.push(EMPTY_HELD);
  }
  if (frames.length > MAX_TOTAL_FRAMES) {
    return `INVALID_PRESS: 总帧数 ${frames.length} 超预算 ${MAX_TOTAL_FRAMES}（Σ每步(hold+gap)+settle ≤ ${MAX_TOTAL_FRAMES}）`;
  }
  return { frames, releaseOffset };
}

/** RomRow（存储层，ms 时间戳）→ 契约视图（ISO 字符串）。 */
export function toRomView(rom: RomRow): {
  id: number;
  name: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  lastPlayedAt: string | null;
  hasSave: boolean;
} {
  return {
    id: rom.id,
    name: rom.name,
    sizeBytes: rom.sizeBytes,
    sha256: rom.sha256,
    createdAt: new Date(rom.createdAt).toISOString(),
    lastPlayedAt: rom.lastPlayedAt === null ? null : new Date(rom.lastPlayedAt).toISOString(),
    hasSave: rom.hasSave,
  };
}
