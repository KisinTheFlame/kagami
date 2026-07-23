import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RetroemuCore } from "../src/emulator/retroemu-core.js";

/**
 * 真核心冒烟（环境门控，CI 不跑）：ROM 是版权物不进仓库，本地跑法——
 *   GBA_TEST_ROM=/path/to/game.gba pnpm --filter @kagami/gba-service test
 * 覆盖 PoC 四项：核心加载 / 步进注键 / 读帧 / SRAM 读写（issue #541）。
 */
const romPath = process.env.GBA_TEST_ROM;

describe.runIf(romPath)("RetroemuCore（真 mGBA 核心冒烟）", () => {
  it("加载 / 步进 / 读帧 / SRAM 往返", async () => {
    const core = new RetroemuCore();
    await core.loadRom(readFileSync(romPath!));
    expect(core.getFps()).toBeCloseTo(59.7275, 3);

    for (let i = 0; i < 60; i++) {
      core.runFrame(new Set());
    }
    for (let i = 0; i < 5; i++) {
      core.runFrame(new Set(["start"]));
    }
    for (let i = 0; i < 60; i++) {
      core.runFrame(new Set());
    }

    const frame = core.readFrameRgba();
    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(240);
    expect(frame?.height).toBe(160);
    expect(frame?.pixels.length).toBe(240 * 160 * 4);

    const sram = core.getSram();
    expect(sram).not.toBeNull();
    core.setSram(Buffer.from("KAGAMI"));
    expect(core.getSram()?.subarray(0, 6).toString()).toBe("KAGAMI");

    // savestate 往返（无感重启的核心前提）：serialize 出快照 → 跑走 30 帧 → unserialize 回来
    const state = core.getState();
    expect(state).not.toBeNull();
    expect(state!.length).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) {
      core.runFrame(new Set(["down"]));
    }
    expect(core.setState(state!)).toBe(true);
    // 恢复后核心仍可正常推进与序列化（尺寸稳定）
    core.runFrame(new Set());
    expect(core.getState()?.length).toBe(state!.length);

    await core.shutdown();

    // 跨实例恢复（重启的真实路径）：全新核心 loadRom 同一 ROM 后注入快照
    const core2 = new RetroemuCore();
    await core2.loadRom(readFileSync(romPath!));
    expect(core2.setState(state!)).toBe(true);
    core2.runFrame(new Set());
    expect(core2.readFrameRgba()).not.toBeNull();
    await core2.shutdown();
  }, 60_000);
});
