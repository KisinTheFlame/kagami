import type { GbaButton } from "@kagami/gba-api/contract";

/** 一帧画面（RGBA，240×160 原始分辨率）。 */
export type GbaFrameRgba = {
  width: number;
  height: number;
  /** RGBA 字节，长度 = width * height * 4。 */
  pixels: Uint8Array;
};

/**
 * 模拟器内核的窄接口：GbaService 只透过它驱动模拟——帧推进权唯一归属调用方（服务端帧循环），
 * 内核自身绝不自转。retroemu 是当前唯一实现（RetroemuCore）；将来换 mgba-wasm 自建 host
 * 只需要新增一个实现，服务层零改动（issue #541 设计决策）。测试用 FakeEmulatorCore。
 */
export interface EmulatorCore {
  /** 加载 ROM 并冷启动（等价真机上电）。同一实例只允许调用一次。 */
  loadRom(rom: Buffer): Promise<void>;
  /** 推进一帧；held 内的键在该帧被按住。 */
  runFrame(held: ReadonlySet<GbaButton>): void;
  /** 最近一次视频回调的帧（RGBA）；核心尚未产帧时为 null。 */
  readFrameRgba(): GbaFrameRgba | null;
  /** 电池存档（SRAM/Flash）字节快照；ROM 无存档通道时为 null。 */
  getSram(): Buffer | null;
  /** 注入电池存档（loadGame 恢复进度用）。ROM 无存档通道时为 no-op。 */
  setSram(bytes: Buffer): void;
  /** 全机器状态快照（libretro savestate，优雅关停的无感重启用）；核心不支持时 null。 */
  getState(): Buffer | null;
  /** 恢复快照；核心校验失败（版本/尺寸不匹配）返回 false，调用方降级冷启动。 */
  setState(bytes: Buffer): boolean;
  /** 核心标称帧率（mGBA = 59.7275）。loadRom 之前调用返回 GBA 标称值。 */
  getFps(): number;
  /** 卸载游戏并释放核心。之后本实例不可再用。 */
  shutdown(): Promise<void>;
}

export type EmulatorCoreFactory = () => EmulatorCore;

/** GBA 标称帧率（loadRom 前的兜底值；mGBA 实测同值）。 */
export const GBA_NOMINAL_FPS = 59.7275;
