import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  GbaButton,
  GbaDeleteResultSchema,
  GbaLoadResultSchema,
  GbaPressStepSchema,
  GbaRunStateSchema,
  GbaScreenResultSchema,
  GbaUploadResultSchema,
} from "@kagami/gba-api/contract";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type {
  EmulatorCore,
  EmulatorCoreFactory,
  GbaMemoryDump,
} from "../emulator/emulator-core.js";
import { encodeFramePng } from "../emulator/frame-png.js";
import type { OssClient } from "../acl/oss-client.js";
import type { GbaStore, ResumeStateRow, RomRow } from "../persistence/gba-store.js";
import { EMPTY_HELD, buildPressPlan } from "./press-plan.js";
import { GbaRomLibrary, MAX_ROM_BYTES } from "./rom-library.js";

type ScreenResult = z.infer<typeof GbaScreenResultSchema>;
type LoadResult = z.infer<typeof GbaLoadResultSchema>;
type UploadResult = z.infer<typeof GbaUploadResultSchema>;
type DeleteResult = z.infer<typeof GbaDeleteResultSchema>;
type RunState = z.infer<typeof GbaRunStateSchema>;
type PressStep = z.infer<typeof GbaPressStepSchema>;

/** 前台空闲看门狗：超时自动转后台 + flush 存档（防 agent 崩溃后模拟器空转）。 */
const WATCHDOG_IDLE_MS = 10 * 60 * 1000;
/** SRAM 周期脏检查间隔。 */
const SRAM_FLUSH_INTERVAL_MS = 30 * 1000;
/** 单 tick 追帧上限：吸收计时器抖动，绝不成为快进通道。 */
const MAX_CATCHUP_FRAMES_PER_TICK = 4;
/** 落后超此值（事件循环卡顿）就丢帧重新对齐——宁可丢帧，绝不快进补作业。 */
const RESYNC_THRESHOLD_MS = 250;

const logger = new AppLogger({ source: "gba-service" });

/** 活动中的 press 计划：每帧一个 held 集合，由帧循环逐帧消费。 */
type PressPlan = {
  frames: ReadonlySet<GbaButton>[];
  cursor: number;
  resolve: (result: ScreenResult) => void;
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
 * - 电池存档：SRAM 周期脏检查（hash 对比）+ blur / 换 ROM / 关停时强制 flush。
 * - 重启语义分两档：**优雅关停**（deploy / PM2 reload）额外落 savestate 快照，下次启动
 *   unserialize 接续停机现场（含前后台，无感重启）；**crash** 没有快照，落回「断电 + 电池
 *   存档」的真机语义（恢复上次 ROM + 存档，冷启动、处于后台）。
 */
export class GbaService {
  private readonly store: GbaStore;
  private readonly ossClient: OssClient;
  private readonly coreFactory: EmulatorCoreFactory;
  private readonly now: () => number;
  private readonly watchdogIdleMs: number;
  /** 卡带库（store + OSS 的 ROM 增删查改）；会话态把关仍在本服务。 */
  private readonly romLibrary: GbaRomLibrary;

  private core: EmulatorCore | null = null;
  private romId: number | null = null;
  private romName: string | null = null;
  private frame = 0;
  private foreground = false;
  private plan: PressPlan | null = null;
  /** loadGame 在飞标记：并发加载会双建核心、泄漏 WASM 实例，一律领域拒绝。 */
  private loadInFlight = false;
  /**
   * deleteRom 在飞标记，与 loadInFlight 对称。store 转 Prisma（异步）后 deleteRom 的 getRom /
   * deleteRom 之间会 await 让出事件循环——若不与 loadGame 互斥，一个并发 loadGame 可能在行被删
   * 之后把 core 装成「幻影 ROM」（元数据行已没、后续 touchLastPlayed 撞 P2025、存档 flush FK 违约）。
   */
  private deleteInFlight = false;
  /** 帧周期（ms），loadGame 成功后按核心实际 fps 缓存——帧循环热路径不重复推导不变量。 */
  private frameMs = 1000 / 59.7275;

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
    this.romLibrary = new GbaRomLibrary({ store, ossClient });
  }

  /**
   * 启动恢复：上次加载的 ROM 装回来（注入电池存档），若有优雅关停留下的 savestate 快照则
   * unserialize 接续停机现场（含前后台，无感重启）；无快照 / 恢复失败降级为冷启动 + 后台
   * （断电语义）。OSS 不可达 / ROM 已删时跳过并告警——服务必须能空手起来，恢复失败不是
   * 启动失败。
   */
  public async init(): Promise<void> {
    const lastRomId = await this.store.getLastRomId();
    if (lastRomId === null) {
      return;
    }
    // 先把快照读进内存：紧随其后的 loadGame 成功会作废持久化行（防 crash 复活，见
    // doLoadGame），启动恢复用的是这份内存副本。
    const resume = await this.store.getResumeState();
    const result = await this.loadGame(lastRomId);
    if (!result.ok) {
      // 快照行留着不清：装 ROM 都没成（多半 OSS 瞬断），让下一次启动仍有机会无感恢复。
      // 运行中任何一次成功加载都会作废它，不会陈旧复活。
      logger.warn("GBA 启动恢复上次 ROM 失败，跳过", {
        event: "gba.restore_last_rom_failed",
        romId: lastRomId,
        reason: result.reason,
      });
      return;
    }
    if (resume) {
      await this.restoreSnapshot(resume, lastRomId);
    }
  }

  /**
   * 优雅关停快照的恢复。持久化行已在本次 loadGame 成功时作废，这里只消费启动前读出的内存
   * 副本。恢复失败（校验不通过 / WASM trap）时核心可能已被 unserialize **部分改写**，不能
   * 当冷启动继续用——整个丢弃（不 flush 可能被污染的 SRAM）后全新重载（review #557 [P2]）。
   */
  private async restoreSnapshot(resume: ResumeStateRow, romId: number): Promise<void> {
    if (resume.romId !== romId || !this.core) {
      return;
    }
    let restored = false;
    try {
      restored = this.core.setState(resume.savestate);
      if (restored) {
        // 推进一帧刷新画面缓冲（理由同 loadGame 的冷启动一帧：让 screenshot 立即有帧可看）；
        // 重启窗口内游戏冻结，恢复后原帧继续，不快进。WASM trap 一并在此遏制，不炸启动。
        this.core.runFrame(EMPTY_HELD);
      }
    } catch (error) {
      logger.errorWithCause("GBA 快照恢复抛错，丢弃半恢复核心重载", error, {
        event: "gba.resume_restore_failed",
        romId,
      });
      restored = false;
    }
    if (!restored) {
      logger.warn("GBA 快照恢复失败（核心校验不通过，多半核心版本变了），丢弃后重载为冷启动", {
        event: "gba.resume_restore_rejected",
        romId,
      });
      await this.reloadDiscardingCore(romId);
      return;
    }
    // 帧计数接续停机瞬间（+1 = 上面刷新画面的那一帧）。
    this.frame = resume.frame + 1;
    this.lastSramHash = this.hashSram();
    if (resume.foreground) {
      await this.setForeground(true);
    }
    logger.info("GBA 无感恢复：接续优雅关停时的现场", {
      event: "gba.resume_restored",
      romId,
      frame: this.frame,
      foreground: resume.foreground,
    });
  }

  /**
   * 恢复失败后的净化重载：丢弃现核心（**不 flush SRAM**——可能已被失败的 unserialize 污染，
   * flush 会拿脏数据覆盖电池存档），再从 OSS + battery_save 全新加载出真正干净的冷启动实例。
   * 重载也失败时保持未加载空手起，服务照常对外。
   */
  private async reloadDiscardingCore(romId: number): Promise<void> {
    const poisoned = this.core;
    this.core = null;
    this.romId = null;
    this.romName = null;
    this.frame = 0;
    this.lastSramHash = null;
    if (poisoned) {
      await poisoned.shutdown().catch(() => {});
    }
    const result = await this.loadGame(romId);
    if (!result.ok) {
      logger.warn("GBA 恢复失败后的重载也失败，保持未加载", {
        event: "gba.resume_reload_failed",
        romId,
        reason: result.reason,
      });
    }
  }

  public state(): RunState {
    return {
      loaded: this.core !== null,
      romName: this.romName,
      foreground: this.foreground,
      frame: this.frame,
    };
  }

  /**
   * 前后台切换（App onFocus/onBlur）。转后台先中止在途 press、flush 电池存档再冻结——
   * flush 失败向上抛（HTTP 500），这是服务故障不是领域拒绝。
   */
  public async setForeground(focused: boolean): Promise<{ foreground: boolean }> {
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
    // 先置后台再 flush：store 转异步后 flush 会 await 让出事件循环，若此间 foreground 仍为 true，
    // 一个到达的 press 会通过 foreground 检查却装进一个没有循环消费的 plan（HTTP 挂起 + 后续 press
    // 全 PRESS_IN_PROGRESS）；一个到达的 setForeground(true) 也会被「focused===foreground」误判为
    // no-op 而丢失。先置 false 让窗口内的 press 干净拒绝、focus 正常生效；flush 失败再回滚为前台。
    this.foreground = false;
    try {
      await this.flushSramIfDirty();
    } catch (error) {
      // flush 失败回滚为前台并恢复帧循环后上抛（HTTP 500）——否则脏存档搁浅到下次前台；回滚后
      // 重试 blur 不会被「focused===foreground」短路（此刻 foreground 又是 true）。
      this.foreground = true;
      this.startLoop();
      throw error;
    }
    logger.info("GBA 转后台（冻结）", { event: "gba.background", romId: this.romId });
    return { foreground: false };
  }

  public async loadGame(romId: number): Promise<LoadResult> {
    this.touchActivity();
    // 在飞互斥：并发 loadGame 会在彼此的 await 间隙双建核心（后设置者胜出、先者永不 shutdown，
    // WASM 实例泄漏且帧循环错位），与 press 的 PRESS_IN_PROGRESS 同理，一律领域拒绝。
    if (this.loadInFlight) {
      return { ok: false, reason: "LOAD_IN_PROGRESS" };
    }
    // 删除在飞时拒载：否则并发 delete 删掉正被本次加载装入的 ROM 行，留下幻影会话（见 deleteInFlight）。
    if (this.deleteInFlight) {
      return { ok: false, reason: "LOAD_IN_PROGRESS" };
    }
    this.loadInFlight = true;
    try {
      return await this.doLoadGame(romId);
    } finally {
      this.loadInFlight = false;
    }
  }

  private async doLoadGame(romId: number): Promise<LoadResult> {
    const rom = await this.store.getRom(romId);
    if (!rom) {
      return { ok: false, reason: "ROM_NOT_FOUND" };
    }

    // 顺序要点：任何会失败的步骤（OSS 拉取 / flush）都放在动旧会话之前——切换失败时
    // 正在玩的游戏毫发无损地继续跑，绝不出现「旧的没了、新的没来」的自毁窗口。
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

    // 换 ROM 前先 flush 当前 SRAM（issue #541 执行细则）；失败拒绝加载，旧会话继续。
    if (this.core) {
      try {
        await this.flushSramIfDirty();
      } catch (error) {
        logger.errorWithCause("GBA 换 ROM 前 flush 存档失败，拒绝加载", error, {
          event: "gba.load_flush_failed",
          fromRomId: this.romId,
          toRomId: romId,
        });
        return { ok: false, reason: "SRAM_FLUSH_FAILED" };
      }
      // 到这里才动旧会话：中止在途 press、停循环、清空全部会话字段（状态保持自洽——
      // 之后任何失败路径下 state() 都是干净的「未加载」，不会 loaded:false 却挂着旧 romId）。
      this.abortPlan("GBA_GAME_UNLOADED: 游戏被切换，按键已全部松开");
      this.stopLoop();
      const old = this.core;
      this.core = null;
      this.romId = null;
      this.romName = null;
      this.frame = 0;
      await old.shutdown();
    }

    const core = this.coreFactory();
    try {
      await core.loadRom(bytes);
    } catch (error) {
      // 坏 ROM / WASM 初始化失败是领域拒绝而非服务故障：init() 依赖它保住「服务必须能
      // 空手起来」的契约（否则启动恢复一颗坏 ROM 会让进程 crash-loop）。
      logger.errorWithCause("GBA 核心加载 ROM 失败", error, {
        event: "gba.rom_load_failed",
        romId,
        romName: rom.name,
      });
      await core.shutdown().catch(() => {});
      return { ok: false, reason: "ROM_LOAD_FAILED" };
    }
    const save = await this.store.getBatterySave(romId);
    if (save) {
      core.setSram(save);
    }

    this.core = core;
    this.romId = romId;
    this.romName = rom.name;
    this.frame = 0;
    this.frameMs = 1000 / core.getFps();
    // 冷启动推进一帧：让 screenshot 立即有帧可看（后台加载也只多这一帧，无实时性影响）。
    core.runFrame(EMPTY_HELD);
    this.frame = 1;
    this.lastSramHash = this.hashSram();
    this.lastSramFlushAt = this.now();

    await this.store.touchLastPlayed(romId);
    await this.store.setLastRomId(romId);
    // 任何一次成功加载都作废持久化快照（review #557 [P1]）：快照描述的是「上一次关停时的
    // 现场」，一旦有新加载（含 OSS 瞬断恢复后的手动加载、换 ROM），它就过时了——留着会在
    // 之后 crash 的下一次启动里复活、回滚新进度。init 的无感恢复用的是启动前读出的内存副本。
    await this.store.clearResumeState();
    if (this.foreground) {
      this.startLoop();
    }
    logger.info("GBA 加载 ROM", { event: "gba.load_game", romId, romName: rom.name });
    return { ok: true, romName: rom.name };
  }

  /** press 工具的平铺形态：单 chord = 单步序列的语法糖，同一条执行路径。 */
  public press(input: {
    buttons: GbaButton[];
    holdFrames: number;
    settleFrames: number;
  }): Promise<ScreenResult> {
    return this.pressSequence({
      steps: [{ buttons: input.buttons, holdFrames: input.holdFrames, gapFrames: 1 }],
      settleFrames: input.settleFrames,
    });
  }

  public pressSequence(input: { steps: PressStep[]; settleFrames: number }): Promise<ScreenResult> {
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

    return new Promise<ScreenResult>(resolve => {
      this.plan = { frames: built.frames, cursor: 0, resolve };
    });
  }

  public screenshot(): ScreenResult {
    this.touchActivity();
    if (!this.core) {
      return { ok: false, reason: "NO_GAME_LOADED" };
    }
    const imageBase64 = this.captureFrameBase64();
    if (imageBase64 === null) {
      return { ok: false, reason: "NO_FRAME_AVAILABLE" };
    }
    return { ok: true, imageBase64 };
  }

  // === ROM 库（控制台管理面）===

  public async listRoms(): Promise<RomRow[]> {
    return await this.romLibrary.list();
  }

  public async uploadRom(input: { name: string; bytes: Buffer }): Promise<UploadResult> {
    return await this.romLibrary.upload(input);
  }

  public async importRomFromOss(input: { resId: string; name: string }): Promise<UploadResult> {
    return await this.romLibrary.importFromOss(input);
  }

  /** 删除前的会话态把关（正在加载 / 正被玩一律先拒），删除机制本身交卡带库。 */
  public async deleteRom(romId: number): Promise<DeleteResult> {
    // loadGame 在飞期间 this.romId 尚未指向目标 ROM，「加载中拒删」的守卫会漏判——
    // 删掉正被加载的 ROM 行会让后续 setLastRomId / 存档 flush 撞 FK。加载期一律拒删。
    if (this.loadInFlight) {
      return { ok: false, reason: "LOAD_IN_PROGRESS" };
    }
    if (romId === this.romId && this.core) {
      return { ok: false, reason: "ROM_LOADED" };
    }
    // 同步置在飞标记（先于任何 await），与 loadGame 的 loadInFlight 对称互斥，堵住 store 异步化后
    // getRom / deleteRom 之间被并发 loadGame 插入的 TOCTOU 窗口。
    this.deleteInFlight = true;
    try {
      return await this.romLibrary.delete(romId);
    } finally {
      this.deleteInFlight = false;
    }
  }

  /** 关停：中止在途 press、冻结、best-effort flush 存档、拍无感重启快照、释放核心。 */
  public async shutdown(): Promise<void> {
    const wasForeground = this.foreground;
    this.abortPlan("GBA_SHUTTING_DOWN: 服务关停，按键已全部松开");
    this.stopLoop();
    this.foreground = false;
    try {
      await this.flushSramIfDirty();
    } catch (error) {
      logger.errorWithCause("GBA 关停 flush 存档失败", error, {
        event: "gba.shutdown_flush_failed",
        romId: this.romId,
      });
    }
    const core = this.core;
    this.core = null;
    if (core) {
      await this.snapshotResumeState(core, wasForeground);
      await core.shutdown();
    }
  }

  /**
   * 优雅关停快照：savestate 全机器状态 + 停机瞬间的前后台/帧计数落库，下次启动无感接续。
   * 只此一处写快照——crash 没走到这里就没有快照，保持「断电 + 电池存档」的真机语义。
   * best-effort：快照失败只告警，绝不阻断关停（电池存档已在上面 flush 过，进度有底）。
   */
  private async snapshotResumeState(core: EmulatorCore, foreground: boolean): Promise<void> {
    if (this.romId === null) {
      return;
    }
    try {
      const savestate = core.getState();
      if (!savestate) {
        return;
      }
      await this.store.saveResumeState({
        romId: this.romId,
        savestate,
        foreground,
        frame: this.frame,
      });
      logger.info("GBA 关停快照落库（无感重启现场）", {
        event: "gba.resume_snapshot_saved",
        romId: this.romId,
        frame: this.frame,
        foreground,
        bytes: savestate.length,
      });
    } catch (error) {
      logger.errorWithCause("GBA 关停快照失败（下次启动为冷启动）", error, {
        event: "gba.resume_snapshot_failed",
        romId: this.romId,
      });
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
    try {
      this.tickInner();
    } catch (error) {
      // 帧推进 / 采帧编码抛错（如 WASM trap）若任其穿透 setTimeout 回调，会命中进程级
      // uncaughtException → process.exit(1)，一帧坏数据杀死整个服务。这里遏制为：冻结会话
      //（自保安全态）、中止在途 press（不悬挂），进程活着等人工介入或重新 loadGame。
      logger.errorWithCause("GBA 帧循环异常，会话已冻结自保", error, {
        event: "gba.tick_fault",
        romId: this.romId,
        frame: this.frame,
      });
      this.abortPlan("EMULATOR_FAULT: 模拟器帧推进异常，会话已冻结");
      this.stopLoop();
      this.foreground = false;
    }
  }

  private tickInner(): void {
    const core = this.core;
    if (!this.foreground || !core) {
      return;
    }
    const frameMs = this.frameMs;
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
    // setForeground 现为异步，tick 保持同步不阻塞帧节奏——fire-and-forget，失败进 .catch 告警
    //（内部 flush 失败会自愈保持前台，见 setForeground）。
    if (this.now() - this.lastActivityAt > this.watchdogIdleMs) {
      logger.info("GBA 前台空闲超时，看门狗自动转后台", { event: "gba.watchdog_background" });
      void this.setForeground(false).catch(error => {
        logger.errorWithCause("GBA 看门狗转后台失败", error, { event: "gba.watchdog_failed" });
      });
      return;
    }
    // SRAM 周期脏检查。flushSramIfDirty 现为异步，同样 fire-and-forget 不阻塞帧节奏——失败进
    // .catch 告警，下一个周期会重试。
    if (this.now() - this.lastSramFlushAt > SRAM_FLUSH_INTERVAL_MS) {
      this.lastSramFlushAt = this.now();
      void this.flushSramIfDirty().catch(error => {
        logger.errorWithCause("GBA 周期 flush 存档失败（下轮重试）", error, {
          event: "gba.periodic_flush_failed",
        });
      });
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
      this.completePlan(plan);
    }
  }

  /** 计划走完：采帧回图。plan 置空即「全部松开」——按键状态完全由 plan 派生。 */
  private completePlan(plan: PressPlan): void {
    this.plan = null;
    const imageBase64 = this.captureFrameBase64();
    if (imageBase64 === null) {
      plan.resolve({ ok: false, reason: "NO_FRAME_AVAILABLE" });
      return;
    }
    plan.resolve({ ok: true, imageBase64 });
  }

  /** 采当前帧并编码 base64 PNG；无帧可采时 null。screenshot 与 completePlan 共用。 */
  private captureFrameBase64(): string | null {
    return this.captureFramePng()?.toString("base64") ?? null;
  }

  /**
   * 控制台实况面的被动采帧（#541 PR3）：只读当前帧、**不 touchActivity**——观战不刷新看门狗,
   * 否则控制台开着页面轮询就会让前台空转的掌机永不休眠。
   */
  public peekFramePng(): Buffer | null {
    return this.captureFramePng();
  }

  private captureFramePng(): Buffer | null {
    const frame = this.core?.readFrameRgba();
    if (!frame) {
      return null;
    }
    return encodeFramePng(frame);
  }

  /**
   * 全量内存 dump（#599）：三大 RAM 区的即时快照 + 采样时的帧计数。未加载 ROM、或核心拿不出
   * 一致的快照时返回 null（HTTP 层 404）。
   *
   * **不 touchActivity**——内存观测是被动读取，不是游玩动作，不该让空闲掌机以为有人在玩
   * （与 state() / peekFramePng() 同一取向）。将来接上工具后若发现分析会话被看门狗打断，
   * 再回来调这条。
   */
  public dumpMemory(): { memory: GbaMemoryDump; frame: number } | null {
    const memory = this.core?.readMemory();
    if (!memory) {
      return null;
    }
    return { memory, frame: this.frame };
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
  private async flushSramIfDirty(): Promise<void> {
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
    await this.store.saveBatterySave(this.romId, sram);
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
