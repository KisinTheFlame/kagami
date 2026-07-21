import os from "node:os";
// 子路径导入：绕开包根 index.js 的 @kmamal/sdl 音频/手柄链，见 src/types/retroemu.d.ts。
import {
  LibretroHost,
  type RetroemuInputManager,
  type RetroemuVideoOutput,
} from "retroemu/src/core/LibretroHost.js";
import type { GbaButton } from "@kagami/gba-api/contract";
import { GBA_NOMINAL_FPS, type EmulatorCore, type GbaFrameRgba } from "./emulator-core.js";

/** libretro joypad 按键 id（RETRO_DEVICE_ID_JOYPAD_*）→ GBA 键位映射。 */
const BUTTON_TO_JOYPAD_ID: Record<GbaButton, number> = {
  b: 0,
  select: 2,
  start: 3,
  up: 4,
  down: 5,
  left: 6,
  right: 7,
  a: 8,
  l: 10,
  r: 11,
};

/** libretro bitmask 查询的特殊 id（RETRO_DEVICE_ID_JOYPAD_MASK）。 */
const JOYPAD_MASK_ID = 256;

/** RETRO_MEMORY_SAVE_RAM。 */
const MEMORY_SAVE_RAM = 0;

type RawFrame = {
  bytes: Uint8Array;
  width: number;
  height: number;
  pitch: number;
  pixelFormat: number;
};

/**
 * retroemu（mGBA libretro WASM 核心）的 EmulatorCore 实现。做法（PoC 验证于 issue #541）：
 * 用 LibretroHost 完成核心加载 / 回调装配，`loadAndStart` 后立刻 `stop()` 掐掉它内置的实时
 * 循环，此后帧推进全部由调用方 `runFrame` 手动驱动——按键 / 视频经构造注入的对象受控：
 * 输入回调读本实例的 held 位掩码，视频回调把帧拷出 heap 暂存。音频丢弃，存档管理 no-op
 * （SRAM 由 GbaService 经 get/setSram 直接进出 sqlite，不落 retroemu 的 .sav 文件）。
 */
export class RetroemuCore implements EmulatorCore {
  private host: LibretroHost | null = null;
  private heldIds: ReadonlySet<number> = new Set();
  private rawFrame: RawFrame | null = null;
  private loaded = false;

  public async loadRom(rom: Buffer): Promise<void> {
    if (this.loaded) {
      throw new Error("[gba] RetroemuCore 只允许 loadRom 一次，换 ROM 请新建实例");
    }
    this.loaded = true;

    const videoOutput: RetroemuVideoOutput = {
      onFrame: (mod, dataPtr, width, height, pitch, pixelFormat) => {
        if (dataPtr === 0) {
          return; // NULL = 复用上一帧
        }
        // 拷出 heap：retro_run 返回后 heap 可能被核心改写。
        this.rawFrame = {
          bytes: mod.HEAPU8.slice(dataPtr, dataPtr + pitch * height),
          width,
          height,
          pitch,
          pixelFormat,
        };
      },
      onCartFrameRGBA: () => {},
      setAspectRatio: () => {},
    };

    const inputManager: RetroemuInputManager = {
      poll: () => {},
      getState: (port, _device, _index, id) => {
        if (port !== 0) {
          return 0;
        }
        if (id === JOYPAD_MASK_ID) {
          let mask = 0;
          for (const held of this.heldIds) {
            mask |= 1 << held;
          }
          return mask;
        }
        return this.heldIds.has(id) ? 1 : 0;
      },
    };

    const host = new LibretroHost({
      videoOutput,
      inputManager,
      // 音频丢弃（headless 无声）；batch 需回报「已消费帧数」否则核心会重试。
      audioBridge: {
        init: async () => {},
        onAudioBatch: (_mod, _ptr, frames) => frames,
        onAudioSample: () => {},
        destroy: () => {},
      },
      // 存档 no-op：SRAM 走 get/setSram 直接进出 sqlite，不落 .sav 文件。
      saveManager: {
        loadSRAM: async () => {},
        saveSRAM: async () => {},
        saveState: async () => {},
        loadState: async () => {},
      },
    });

    // romPath 只用于扩展名探测（.gba → mgba 核心）与存档目录推导（fake no-op），字节走 romData，
    // 磁盘上并不存在该文件。saveDir 指到系统临时目录，避免在仓库里 mkdir 出无用目录。
    await host.loadAndStart("kagami-rom.gba", {
      romData: rom,
      saveDir: os.tmpdir(),
      systemDir: os.tmpdir(),
    });
    // 掐掉内置实时循环：loadAndStart 的首个 tick 经 setImmediate 调度，本行在同一微任务链上
    // 先执行，内置循环实际推进 0 帧——帧推进权从此唯一归属调用方（PoC 验证）。
    host.stop();
    this.host = host;
  }

  public runFrame(held: ReadonlySet<GbaButton>): void {
    const host = this.requireHost();
    const ids = new Set<number>();
    for (const button of held) {
      ids.add(BUTTON_TO_JOYPAD_ID[button]);
    }
    this.heldIds = ids;
    host.core._retro_run();
  }

  public readFrameRgba(): GbaFrameRgba | null {
    const raw = this.rawFrame;
    if (!raw) {
      return null;
    }
    return convertToRgba(raw);
  }

  public getSram(): Buffer | null {
    const host = this.requireHost();
    const ptr = host.core._retro_get_memory_data(MEMORY_SAVE_RAM);
    const size = host.core._retro_get_memory_size(MEMORY_SAVE_RAM);
    if (!ptr || !size) {
      return null;
    }
    return Buffer.from(host.core.HEAPU8.slice(ptr, ptr + size));
  }

  public setSram(bytes: Buffer): void {
    const host = this.requireHost();
    const ptr = host.core._retro_get_memory_data(MEMORY_SAVE_RAM);
    const size = host.core._retro_get_memory_size(MEMORY_SAVE_RAM);
    if (!ptr || !size) {
      return;
    }
    host.core.HEAPU8.set(bytes.subarray(0, Math.min(bytes.length, size)), ptr);
  }

  public getFps(): number {
    return this.host?.systemAVInfo?.timing.fps ?? GBA_NOMINAL_FPS;
  }

  public async shutdown(): Promise<void> {
    const host = this.host;
    this.host = null;
    this.rawFrame = null;
    if (host) {
      // saveManager 是 no-op，shutdown 只做核心卸载 / 释放。
      await host.shutdown();
    }
  }

  private requireHost(): LibretroHost {
    if (!this.host) {
      throw new Error("[gba] RetroemuCore 尚未 loadRom");
    }
    return this.host;
  }
}

/** libretro 像素格式（SET_PIXEL_FORMAT）：0 = 0RGB1555，1 = XRGB8888，2 = RGB565。 */
function convertToRgba(raw: RawFrame): GbaFrameRgba {
  const { bytes, width, height, pitch, pixelFormat } = raw;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      if (pixelFormat === 1) {
        // XRGB8888（小端存储：B G R X）
        const p = y * pitch + x * 4;
        b = bytes[p] ?? 0;
        g = bytes[p + 1] ?? 0;
        r = bytes[p + 2] ?? 0;
      } else if (pixelFormat === 2) {
        // RGB565（mGBA 实际使用的格式，pitch 单位字节）
        const p = y * pitch + x * 2;
        const v = (bytes[p] ?? 0) | ((bytes[p + 1] ?? 0) << 8);
        r = ((v >> 11) & 0x1f) << 3;
        g = ((v >> 5) & 0x3f) << 2;
        b = (v & 0x1f) << 3;
      } else {
        // 0RGB1555
        const p = y * pitch + x * 2;
        const v = (bytes[p] ?? 0) | ((bytes[p + 1] ?? 0) << 8);
        r = ((v >> 10) & 0x1f) << 3;
        g = ((v >> 5) & 0x1f) << 3;
        b = (v & 0x1f) << 3;
      }
      pixels[out] = r;
      pixels[out + 1] = g;
      pixels[out + 2] = b;
      pixels[out + 3] = 255;
    }
  }
  return { width, height, pixels };
}
