import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GbaService } from "../src/application/gba.service.js";
import { FakeEmulatorCore, FakeOssClient, createMemoryStore, fakeRomBytes } from "./helpers.js";
import { initTestLoggerRuntime } from "./helpers/logger.js";
import type { GbaStore } from "../src/persistence/gba-store.js";

initTestLoggerRuntime();

/**
 * GbaService 状态机测试：fake timers 驱动帧循环（fps=60 → 每帧 ~16.67ms），FakeEmulatorCore
 * 记录每帧 held 集合，断言按键计划、实速节奏、finally 清键与存档语义。
 */
describe("GbaService", () => {
  let store: GbaStore;
  let oss: FakeOssClient;
  let cores: FakeEmulatorCore[];
  let service: GbaService;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createMemoryStore();
    oss = new FakeOssClient();
    cores = [];
    service = new GbaService({
      store,
      ossClient: oss,
      coreFactory: () => {
        const core = new FakeEmulatorCore();
        cores.push(core);
        return core;
      },
    });
  });

  afterEach(async () => {
    await service.shutdown();
    vi.useRealTimers();
  });

  async function uploadAndLoad(name = "测试 ROM"): Promise<number> {
    const upload = await service.uploadRom({ name, bytes: fakeRomBytes() });
    if (!upload.ok) {
      throw new Error(`upload 失败: ${upload.reason}`);
    }
    const load = await service.loadGame(upload.rom.id);
    if (!load.ok) {
      throw new Error(`load 失败: ${load.reason}`);
    }
    return upload.rom.id;
  }

  describe("loadGame / state", () => {
    it("不存在的 ROM 领域拒绝", async () => {
      const result = await service.loadGame(999);
      expect(result).toEqual({ ok: false, reason: "ROM_NOT_FOUND" });
    });

    it("OSS 不可达时领域拒绝且不崩", async () => {
      const upload = await service.uploadRom({ name: "g", bytes: fakeRomBytes() });
      expect(upload.ok).toBe(true);
      oss.failGet = true;
      const result = await service.loadGame(1);
      expect(result).toEqual({ ok: false, reason: "ROM_FETCH_FAILED" });
      expect(service.state().loaded).toBe(false);
    });

    it("加载成功：冷启动一帧、时间线就绪、run_state 落库", async () => {
      const romId = await uploadAndLoad();
      const state = service.state();
      expect(state.loaded).toBe(true);
      expect(state.romName).toBe("测试 ROM");
      expect(state.frame).toBe(1); // 冷启动推进的一帧
      expect(state.foreground).toBe(false);
      expect(store.getLastRomId()).toBe(romId);
      // 后台加载：帧循环不跑
      await vi.advanceTimersByTimeAsync(1000);
      expect(service.state().frame).toBe(1);
    });

    it("重启恢复：新 service init 后自动装回上次 ROM 与电池存档", async () => {
      const romId = await uploadAndLoad();
      const core = cores[0]!;
      core.sram = Buffer.from("SAVEDATA".padEnd(128, "\0"));
      service.setForeground(true);
      service.setForeground(false); // blur 强制 flush
      expect(store.getBatterySave(romId)).not.toBeNull();

      const service2 = new GbaService({
        store,
        ossClient: oss,
        coreFactory: () => {
          const core2 = new FakeEmulatorCore();
          core2.sram = Buffer.alloc(128, 0);
          cores.push(core2);
          return core2;
        },
      });
      await service2.init();
      expect(service2.state().loaded).toBe(true);
      expect(service2.state().foreground).toBe(false); // 冷启动处于后台
      const restored = cores[1]!;
      expect(restored.sram?.subarray(0, 8).toString()).toBe("SAVEDATA");
      await service2.shutdown();
    });
  });

  describe("无感重启（优雅关停快照）", () => {
    function buildService2(configure?: (core: FakeEmulatorCore) => void): GbaService {
      return new GbaService({
        store,
        ossClient: oss,
        coreFactory: () => {
          const core = new FakeEmulatorCore();
          configure?.(core);
          cores.push(core);
          return core;
        },
      });
    }

    it("前台优雅关停：快照落库；init 恢复现场（同字节注入、前台继续、帧计数接续、消费即删）", async () => {
      await uploadAndLoad();
      service.setForeground(true);
      await vi.advanceTimersByTimeAsync(500); // 跑出一段进度
      const frameAtShutdown = service.state().frame;
      expect(frameAtShutdown).toBeGreaterThan(1);

      await service.shutdown();
      const saved = store.getResumeState();
      expect(saved).not.toBeNull();
      expect(saved?.foreground).toBe(true);
      expect(saved?.frame).toBe(frameAtShutdown);
      expect(saved?.savestate).toEqual(Buffer.from("fake-savestate"));

      const service2 = buildService2();
      await service2.init();
      const restored = cores[1]!;
      expect(restored.setStateCalls).toHaveLength(1);
      expect(restored.setStateCalls[0]).toEqual(Buffer.from("fake-savestate"));
      // 接续现场：前台恢复、帧循环继续跑、帧计数从停机瞬间接续（+1 为刷新画面的一帧）
      expect(service2.state().foreground).toBe(true);
      expect(service2.state().frame).toBe(frameAtShutdown + 1);
      await vi.advanceTimersByTimeAsync(200);
      expect(service2.state().frame).toBeGreaterThan(frameAtShutdown + 1);
      // 消费即删：快照不会隔代复活
      expect(store.getResumeState()).toBeNull();
      await service2.shutdown();
    });

    it("后台优雅关停：恢复后仍后台冻结", async () => {
      await uploadAndLoad();
      await service.shutdown(); // 从未转前台

      const service2 = buildService2();
      await service2.init();
      expect(cores[1]!.setStateCalls).toHaveLength(1);
      expect(service2.state().foreground).toBe(false);
      const frame = service2.state().frame;
      await vi.advanceTimersByTimeAsync(1000);
      expect(service2.state().frame).toBe(frame); // 冻结：帧循环不跑
      await service2.shutdown();
    });

    it("快照校验不通过（核心版本变了）：丢弃半恢复核心、全新重载为真冷启动，快照已删", async () => {
      await uploadAndLoad();
      service.setForeground(true);
      await service.shutdown();

      const service2 = buildService2(core => {
        core.failSetState = true;
      });
      await service2.init();
      // 吃过失败 unserialize 的核心（cores[1]）不能继续用：整个丢弃，重载出干净实例（cores[2]）
      expect(cores).toHaveLength(3);
      expect(cores[1]!.shutdownCalled).toBe(true);
      expect(cores[2]!.setStateCalls).toHaveLength(0);
      // 冷启动语义：只有 loadGame 的一帧、后台
      expect(service2.state().loaded).toBe(true);
      expect(service2.state().frame).toBe(1);
      expect(service2.state().foreground).toBe(false);
      expect(store.getResumeState()).toBeNull();
      await service2.shutdown();
    });

    it("OSS 瞬断保留快照；之后任何成功加载作废快照，crash 后不复活回滚（review #557 [P1]）", async () => {
      const romId = await uploadAndLoad();
      service.setForeground(true);
      await service.shutdown(); // 写快照

      oss.failGet = true;
      const service2 = buildService2();
      await service2.init(); // 装 ROM 失败：快照保留，下次启动仍有机会无感恢复
      expect(service2.state().loaded).toBe(false);
      expect(store.getResumeState()).not.toBeNull();

      // 运行中手动加载成功 → 快照作废（不恢复：手动加载 = 插卡带开机的冷启动语义）
      oss.failGet = false;
      const load = await service2.loadGame(romId);
      expect(load.ok).toBe(true);
      expect(cores[1]!.setStateCalls).toHaveLength(0);
      expect(store.getResumeState()).toBeNull();

      // 此后 crash（不调 shutdown）再启动：无快照可复活，冷启动 + 电池存档
      const service3 = buildService2();
      await service3.init();
      expect(cores[2]!.setStateCalls).toHaveLength(0);
      expect(service3.state().frame).toBe(1);
      await service3.shutdown();
      await service2.shutdown();
    });

    it("crash（未优雅关停）：无快照，落回断电 + 电池存档语义", async () => {
      await uploadAndLoad();
      service.setForeground(true);
      await vi.advanceTimersByTimeAsync(500);
      // 不调 shutdown，直接模拟重启
      expect(store.getResumeState()).toBeNull();

      const service2 = buildService2();
      await service2.init();
      expect(cores[1]!.setStateCalls).toHaveLength(0);
      expect(service2.state().frame).toBe(1); // 冷启动
      expect(service2.state().foreground).toBe(false);
      await service2.shutdown();
    });

    it("核心不支持 savestate：关停不写快照", async () => {
      await uploadAndLoad();
      cores[0]!.stateBlob = null;
      await service.shutdown();
      expect(store.getResumeState()).toBeNull();
    });

    it("未加载 ROM 时关停不写快照", async () => {
      await service.shutdown();
      expect(store.getResumeState()).toBeNull();
    });
  });

  describe("press 领域校验", () => {
    beforeEach(async () => {
      await uploadAndLoad();
      service.setForeground(true);
    });

    it.each([
      [
        "steps 超上限",
        {
          steps: Array.from({ length: 9 }, () => ({
            buttons: ["a" as const],
            holdFrames: 1,
            gapFrames: 1,
          })),
          settleFrames: 0,
        },
        /steps 数量/,
      ],
      [
        "chord 超上限",
        {
          steps: [{ buttons: ["a", "b", "l", "r", "start"] as const, holdFrames: 1, gapFrames: 1 }],
          settleFrames: 0,
        },
        /同时按 5 键/,
      ],
      [
        "互斥方向 up+down",
        {
          steps: [{ buttons: ["up", "down"] as const, holdFrames: 1, gapFrames: 1 }],
          settleFrames: 0,
        },
        /up\+down/,
      ],
      [
        "互斥方向 left+right",
        {
          steps: [{ buttons: ["left", "right"] as const, holdFrames: 1, gapFrames: 1 }],
          settleFrames: 0,
        },
        /left\+right/,
      ],
      [
        "重复键",
        { steps: [{ buttons: ["a", "a"] as const, holdFrames: 1, gapFrames: 1 }], settleFrames: 0 },
        /重复键/,
      ],
      [
        "holdFrames 超上限",
        { steps: [{ buttons: ["a"] as const, holdFrames: 121, gapFrames: 1 }], settleFrames: 0 },
        /holdFrames 121/,
      ],
      [
        "gapFrames 超上限",
        { steps: [{ buttons: ["a"] as const, holdFrames: 1, gapFrames: 31 }], settleFrames: 0 },
        /gapFrames 31/,
      ],
      [
        "settleFrames 超上限",
        { steps: [{ buttons: ["a"] as const, holdFrames: 1, gapFrames: 1 }], settleFrames: 121 },
        /settleFrames 121/,
      ],
      [
        "总帧预算超限",
        {
          steps: Array.from({ length: 3 }, () => ({
            buttons: ["a" as const],
            holdFrames: 100,
            gapFrames: 10,
          })),
          settleFrames: 0,
        },
        /总帧数 330 超预算 300/,
      ],
    ])("%s → INVALID_PRESS 领域拒绝", async (_name, input, pattern) => {
      const result = await service.pressSequence({
        steps: input.steps.map(s => ({ ...s, buttons: [...s.buttons] })),
        settleFrames: input.settleFrames,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/^INVALID_PRESS/);
        expect(result.reason).toMatch(pattern);
      }
    });

    it("未加载 / 后台 / 并发各自拒绝", async () => {
      // 后台
      service.setForeground(false);
      expect(await service.press({ buttons: ["a"], holdFrames: 3, settleFrames: 0 })).toEqual({
        ok: false,
        reason: "GBA_NOT_FOREGROUND",
      });

      // 并发：第一发在飞（不推进时钟），第二发拒绝
      service.setForeground(true);
      const first = service.press({ buttons: ["a"], holdFrames: 3, settleFrames: 3 });
      expect(await service.press({ buttons: ["b"], holdFrames: 3, settleFrames: 0 })).toEqual({
        ok: false,
        reason: "PRESS_IN_PROGRESS",
      });
      await vi.advanceTimersByTimeAsync(500);
      expect((await first).ok).toBe(true);
    });
  });

  describe("press 执行与实速", () => {
    beforeEach(async () => {
      await uploadAndLoad();
      service.setForeground(true);
    });

    it("按键计划逐帧生效，结束后按键全松开，元数据自洽", async () => {
      const core = cores[0]!;
      const baseline = core.frames.length;
      const promise = service.press({ buttons: ["a"], holdFrames: 3, settleFrames: 12 });
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.imageBase64.length).toBeGreaterThan(0);
      }
      // 计划:hold 3 帧按住 a,其后(gap/settle/计划外空转)全松开
      const during = core.frames.slice(baseline);
      expect(during.filter(f => f.has("a"))).toHaveLength(3);
      expect(during[0]?.has("a")).toBe(true);
      expect(during[2]?.has("a")).toBe(true);
      expect(during[3]?.size).toBe(0);
      expect(during.slice(3).every(f => f.size === 0)).toBe(true);
    });

    it("实速：1 秒墙钟最多推进 ~60 帧，绝不快进", async () => {
      const core = cores[0]!;
      const baseline = core.frames.length;
      const promise = service.pressSequence({
        steps: [
          { buttons: ["a"], holdFrames: 120, gapFrames: 30 },
          { buttons: ["b"], holdFrames: 120, gapFrames: 20 },
        ],
        settleFrames: 10, // 共 300 帧 = 5s
      });
      await vi.advanceTimersByTimeAsync(1000);
      const after1s = core.frames.length - baseline;
      expect(after1s).toBeLessThanOrEqual(62); // 60fps + 抖动余量
      expect(after1s).toBeGreaterThanOrEqual(58);
      await vi.advanceTimersByTimeAsync(4200);
      const result = await promise;
      expect(result.ok).toBe(true); // 计划(300 帧)已在实速下走完
      expect(core.frames.length - baseline).toBeGreaterThanOrEqual(300);
      expect(core.frames.length - baseline).toBeLessThanOrEqual(325); // 5.2s 实速上界
    });

    it("切后台中止在途 press：领域拒绝 + 按键清空 + 冻结", async () => {
      const core = cores[0]!;
      const promise = service.press({ buttons: ["right"], holdFrames: 120, settleFrames: 0 });
      await vi.advanceTimersByTimeAsync(200); // 推进十几帧,按住 right 中
      const framesBefore = core.frames.length;
      expect(core.frames[framesBefore - 1]?.has("right")).toBe(true);

      service.setForeground(false);
      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/^GBA_NOT_FOREGROUND/);
      }
      // 冻结：不再推进
      await vi.advanceTimersByTimeAsync(1000);
      expect(core.frames.length).toBe(framesBefore);
      // 重新前台：计划已清，空手推进（按键不卡死）
      service.setForeground(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(core.frames.slice(framesBefore).every(f => f.size === 0)).toBe(true);
    });
  });

  describe("电池存档", () => {
    it("blur 强制 flush；内容不变时不重复写", async () => {
      const romId = await uploadAndLoad();
      const core = cores[0]!;
      service.setForeground(true);
      core.sram = Buffer.from("PROGRESS".padEnd(128, "\0"));
      service.setForeground(false);
      const saved = store.getBatterySave(romId);
      expect(saved?.subarray(0, 8).toString()).toBe("PROGRESS");

      // 内容未变，再次 blur 不应改变 updated_at 语义（用另一份引用对比字节即可）
      service.setForeground(true);
      service.setForeground(false);
      expect(store.getBatterySave(romId)?.subarray(0, 8).toString()).toBe("PROGRESS");
    });

    it("前台期间周期脏检查落库", async () => {
      const romId = await uploadAndLoad();
      const core = cores[0]!;
      service.setForeground(true);
      await vi.advanceTimersByTimeAsync(1000);
      core.sram = Buffer.from("AUTOSAVE".padEnd(128, "\0"));
      await vi.advanceTimersByTimeAsync(31_000); // 越过 30s 周期
      expect(store.getBatterySave(romId)?.subarray(0, 8).toString()).toBe("AUTOSAVE");
    });

    it("换 ROM 先 flush 旧档再卸载", async () => {
      const romA = await uploadAndLoad("ROM A");
      const coreA = cores[0]!;
      service.setForeground(true);
      coreA.sram = Buffer.from("A-SAVE".padEnd(128, "\0"));

      const uploadB = await service.uploadRom({ name: "ROM B", bytes: fakeRomBytes(7) });
      expect(uploadB.ok).toBe(true);
      if (!uploadB.ok) return;
      const result = await service.loadGame(uploadB.rom.id);
      expect(result.ok).toBe(true);
      expect(store.getBatterySave(romA)?.subarray(0, 6).toString()).toBe("A-SAVE");
      expect(coreA.shutdownCalled).toBe(true);
      expect(service.state().romName).toBe("ROM B");
    });
  });

  describe("review #541 回归", () => {
    it("并发 loadGame:后到者领域拒绝,不泄漏核心", async () => {
      const upload = await service.uploadRom({ name: "并发", bytes: fakeRomBytes(4) });
      expect(upload.ok).toBe(true);
      if (!upload.ok) return;
      const [a, b] = await Promise.all([
        service.loadGame(upload.rom.id),
        service.loadGame(upload.rom.id),
      ]);
      const results = [a, b];
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.filter(r => !r.ok && r.reason === "LOAD_IN_PROGRESS")).toHaveLength(1);
      expect(cores).toHaveLength(1); // 只建了一个核心
    });

    it("切 ROM 拉取失败:旧会话毫发无损继续跑", async () => {
      await uploadAndLoad("旧游戏");
      service.setForeground(true);
      const uploadB = await service.uploadRom({ name: "新游戏", bytes: fakeRomBytes(8) });
      expect(uploadB.ok).toBe(true);
      if (!uploadB.ok) return;

      oss.failGet = true;
      const result = await service.loadGame(uploadB.rom.id);
      expect(result).toEqual({ ok: false, reason: "ROM_FETCH_FAILED" });
      // 旧会话仍在:状态自洽、帧循环继续推进
      expect(service.state().romName).toBe("旧游戏");
      expect(service.state().loaded).toBe(true);
      const before = service.state().frame;
      await vi.advanceTimersByTimeAsync(500);
      expect(service.state().frame).toBeGreaterThan(before);
    });

    it("坏 ROM 加载:领域拒绝而非抛穿,init 恢复坏 ROM 不炸服务", async () => {
      const upload = await service.uploadRom({ name: "坏的", bytes: fakeRomBytes(5) });
      expect(upload.ok).toBe(true);
      if (!upload.ok) return;
      // 让下一个核心 loadRom 抛错
      const origFactory = cores.length;
      const badService = new GbaService({
        store,
        ossClient: oss,
        coreFactory: () => {
          const core = new FakeEmulatorCore();
          core.failLoad = true;
          cores.push(core);
          return core;
        },
      });
      const result = await badService.loadGame(upload.rom.id);
      expect(result).toEqual({ ok: false, reason: "ROM_LOAD_FAILED" });
      expect(badService.state().loaded).toBe(false);
      expect(badService.state().romName).toBeNull(); // 状态自洽的空态
      expect(cores[origFactory]!.shutdownCalled).toBe(true); // 半成品核心已释放
      // init() 走同一路径:坏 ROM 不会让启动抛穿
      store.setLastRomId(upload.rom.id);
      await expect(badService.init()).resolves.toBeUndefined();
      await badService.shutdown();
    });

    it("帧循环异常遏制:冻结自保、press 拿到领域拒绝、服务活着", async () => {
      await uploadAndLoad();
      const core = cores[0]!;
      service.setForeground(true);
      const promise = service.press({ buttons: ["a"], holdFrames: 30, settleFrames: 0 });
      core.throwOnNextRunFrame = true;
      await vi.advanceTimersByTimeAsync(200);
      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/^EMULATOR_FAULT/);
      }
      expect(service.state().foreground).toBe(false); // 冻结自保
      // 服务仍可用:重新前台可继续玩
      service.setForeground(true);
      const retry = await (async () => {
        const p = service.press({ buttons: ["b"], holdFrames: 3, settleFrames: 0 });
        await vi.advanceTimersByTimeAsync(500);
        return p;
      })();
      expect(retry.ok).toBe(true);
    });

    it("blur flush 失败可重试:保持前台,重试成功后转后台", async () => {
      const romId = await uploadAndLoad();
      const core = cores[0]!;
      service.setForeground(true);
      core.sram = Buffer.from("RETRY".padEnd(128, "\0"));
      const origSave = store.saveBatterySave.bind(store);
      let failures = 1;
      store.saveBatterySave = (id, bytes): void => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("写盘失败（测试）");
        }
        origSave(id, bytes);
      };
      expect(() => service.setForeground(false)).toThrow(/写盘失败/);
      expect(service.state().foreground).toBe(true); // 未置位,可重试
      expect(service.setForeground(false)).toEqual({ foreground: false });
      expect(store.getBatterySave(romId)?.subarray(0, 5).toString()).toBe("RETRY");
    });

    it("并发上传同一 ROM:后到者归一为 DUPLICATE_ROM 并回收孤儿 OSS 对象", async () => {
      const bytes = fakeRomBytes(6);
      const [a, b] = await Promise.all([
        service.uploadRom({ name: "同一个", bytes }),
        service.uploadRom({ name: "同一个", bytes }),
      ]);
      const results = [a, b];
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(
        results.filter(
          r => !r.ok && (r.reason === "DUPLICATE_ROM" || r.reason === "DUPLICATE_NAME"),
        ),
      ).toHaveLength(1);
      expect(oss.objects.size).toBe(1); // 孤儿对象已回收
      expect(service.listRoms()).toHaveLength(1);
    });
  });

  describe("看门狗", () => {
    it("前台空闲超窗自动转后台并 flush（窗口注入 2s，生产默认 10 分钟）", async () => {
      // 独立 service：注入短看门狗窗口，避免假时钟逐帧推几万个 tick（根级并行下会超时抖动）。
      const watchService = new GbaService({
        store,
        ossClient: oss,
        coreFactory: () => {
          const core = new FakeEmulatorCore();
          cores.push(core);
          return core;
        },
        watchdogIdleMs: 2000,
      });
      const upload = await watchService.uploadRom({ name: "看门狗", bytes: fakeRomBytes(3) });
      expect(upload.ok).toBe(true);
      if (!upload.ok) return;
      const load = await watchService.loadGame(upload.rom.id);
      expect(load.ok).toBe(true);
      const core = cores[cores.length - 1]!;
      watchService.setForeground(true);
      core.sram = Buffer.from("IDLE".padEnd(128, "\0"));
      await vi.advanceTimersByTimeAsync(3500);
      expect(watchService.state().foreground).toBe(false);
      expect(store.getBatterySave(upload.rom.id)?.subarray(0, 4).toString()).toBe("IDLE");
      await watchService.shutdown();
    });

    it("控制台观战(peekFramePng/state)是被动的:不刷新看门狗", async () => {
      const watchService = new GbaService({
        store,
        ossClient: oss,
        coreFactory: () => {
          const core = new FakeEmulatorCore();
          cores.push(core);
          return core;
        },
        watchdogIdleMs: 2000,
      });
      const upload = await watchService.uploadRom({ name: "观战", bytes: fakeRomBytes(11) });
      expect(upload.ok).toBe(true);
      if (!upload.ok) return;
      await watchService.loadGame(upload.rom.id);
      watchService.setForeground(true);
      // 临近超时前持续观战轮询——若 peek 刷新活动,看门狗永不触发。
      await vi.advanceTimersByTimeAsync(1500);
      expect(watchService.peekFramePng()).not.toBeNull();
      watchService.state();
      await vi.advanceTimersByTimeAsync(1000);
      expect(watchService.state().foreground).toBe(false); // 照常在原始期限转后台
      await watchService.shutdown();
    });
  });

  describe("ROM 库", () => {
    it("importRomFromOss:从 OSS 拉字节走同一校验入库;来源缺失/非 ROM 领域拒绝", async () => {
      const sourceKey = await oss.putObject({
        bytes: fakeRomBytes(21),
        mimeType: "application/octet-stream",
      });
      const imported = await service.importRomFromOss({ resId: sourceKey, name: "群友给的" });
      expect(imported.ok).toBe(true);
      if (imported.ok) {
        expect(imported.rom.name).toBe("群友给的");
      }
      expect(service.listRoms()).toHaveLength(1);

      expect(await service.importRomFromOss({ resId: "res-404", name: "x" })).toEqual({
        ok: false,
        reason: "SOURCE_NOT_FOUND",
      });
      const junkKey = await oss.putObject({
        bytes: Buffer.alloc(512, 0),
        mimeType: "application/octet-stream",
      });
      expect(await service.importRomFromOss({ resId: junkKey, name: "垃圾" })).toEqual({
        ok: false,
        reason: "NOT_A_GBA_ROM",
      });
    });

    it("上传校验：尺寸 / 卡带头 / sha 去重 / 名称去重", async () => {
      expect(await service.uploadRom({ name: "太小", bytes: Buffer.alloc(10) })).toEqual({
        ok: false,
        reason: "INVALID_ROM_SIZE",
      });
      expect(await service.uploadRom({ name: "不是 ROM", bytes: Buffer.alloc(512, 0) })).toEqual({
        ok: false,
        reason: "NOT_A_GBA_ROM",
      });

      const first = await service.uploadRom({ name: "正版", bytes: fakeRomBytes(1) });
      expect(first.ok).toBe(true);
      expect(await service.uploadRom({ name: "重复内容", bytes: fakeRomBytes(1) })).toEqual({
        ok: false,
        reason: "DUPLICATE_ROM",
      });
      expect(await service.uploadRom({ name: "正版", bytes: fakeRomBytes(2) })).toEqual({
        ok: false,
        reason: "DUPLICATE_NAME",
      });
      expect(service.listRoms()).toHaveLength(1);
    });

    it("删除：加载中的拒删；成功删除连带 OSS best-effort，OSS 失败不回滚", async () => {
      const romId = await uploadAndLoad();
      expect(await service.deleteRom(romId)).toEqual({ ok: false, reason: "ROM_LOADED" });

      const other = await service.uploadRom({ name: "另一个", bytes: fakeRomBytes(9) });
      expect(other.ok).toBe(true);
      if (!other.ok) return;
      oss.failDelete = true;
      expect(await service.deleteRom(other.rom.id)).toEqual({ ok: true });
      expect(store.getRom(other.rom.id)).toBeNull();
    });
  });
});
