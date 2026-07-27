import os from "node:os";
// 子路径导入：绕开包根 index.js 的 @kmamal/sdl 音频/手柄链，见 src/types/retroemu.d.ts。
import {
  LibretroHost,
  type RetroemuInputManager,
  type RetroemuVideoOutput,
} from "retroemu/src/core/LibretroHost.js";
import type { GbaButton } from "@kagami/gba-api/contract";
import { AppLogger } from "@kagami/kernel/logger/logger";
import {
  GBA_NOMINAL_FPS,
  type EmulatorCore,
  type GbaFrameRgba,
  type GbaMemoryDump,
} from "./emulator-core.js";

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
/**
 * 布局校验用的两个 memory id（都不作为 dump 的数据源，只当锚点）。
 * SYSTEM_RAM 在 mGBA 上指向 EWRAM 基址，但它声明的 size 是 IWRAM 的 32KiB——少报 8 倍，
 * 故只用其指针、不信其尺寸（见 matchesLiveRegion）。
 */
const MEMORY_SYSTEM_RAM = 2;
const MEMORY_VIDEO_RAM = 3;

/**
 * mGBA savestate（`retro_serialize` 输出）里三大 RAM 区的偏移（#599，实测逆向所得）。前
 * `0x61000` 字节是定长结构，其后是 extdata（含 SRAM，长度随游戏变，本模块不用）。
 *
 * 这些偏移**不是 libretro 公开契约**，是对 mGBA 私有 `GBASerializedState` 布局的观测结果，
 * 核心一升版就可能漂——所以 readMemory 每次都用 `retro_get_memory_data(VIDEO_RAM)` 交叉验
 * 证 VRAM 段，对不上就整体拒绝（宁可 404，绝不返回错位字节）。
 *
 * 为什么不用 `retro_get_memory_data` 直接取三个区：IWRAM 根本没有对应的 memory id
 *（retroemu 0.4.8 把 RETRO_ENVIRONMENT_SET_MEMORY_MAPS 直接忽略了，描述符全丢），而
 * SYSTEM_RAM(id=2) 虽然指针是 EWRAM 基址、其声明尺寸却是 IWRAM 的 32 KiB（少报 8 倍）。
 * savestate 是唯一能一次拿全三个区的通路。
 */
const STATE_OFF_VRAM = 0x1000;
const STATE_SIZE_VRAM = 0x18000; // 96 KiB
const STATE_OFF_IWRAM = STATE_OFF_VRAM + STATE_SIZE_VRAM; // 0x19000
const STATE_SIZE_IWRAM = 0x8000; // 32 KiB
const STATE_OFF_EWRAM = STATE_OFF_IWRAM + STATE_SIZE_IWRAM; // 0x21000
const STATE_SIZE_EWRAM = 0x40000; // 256 KiB
/** 定长前缀的总长；savestate 短于它说明布局假设已经失效。 */
const STATE_FIXED_PREFIX_SIZE = STATE_OFF_EWRAM + STATE_SIZE_EWRAM; // 0x61000

const logger = new AppLogger({ source: "gba-emulator" });

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
const EMPTY_ID_SET: ReadonlySet<number> = new Set();

export class RetroemuCore implements EmulatorCore {
  private host: LibretroHost | null = null;
  private heldIds: ReadonlySet<number> = EMPTY_ID_SET;
  private rawFrame: RawFrame | null = null;
  /** 帧拷贝复用缓冲：60fps 下每帧新分配 ~80KB 纯属 GC churn（review #541）。 */
  private frameCopy: Uint8Array | null = null;
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
        // 拷出 heap（retro_run 返回后 heap 可能被核心改写），写进复用缓冲：
        // 绝大多数帧拷出即被下一帧覆盖、从未被读，不值得每帧新分配。
        const size = pitch * height;
        if (this.frameCopy === null || this.frameCopy.length !== size) {
          this.frameCopy = new Uint8Array(size);
        }
        this.frameCopy.set(mod.HEAPU8.subarray(dataPtr, dataPtr + size));
        this.rawFrame = { bytes: this.frameCopy, width, height, pitch, pixelFormat };
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
    // 掐掉内置实时循环：loadAndStart 末尾同步跑首个 tick（elapsed≈0，推进 0 帧）后经
    // setTimeout(~15ms) 调度下一个 tick；本行在 await 续体（微任务）中先于该宏任务执行，
    // 故内置循环实际推进 0 帧，帧推进权从此唯一归属调用方（对照 LibretroHost._runLoop 源码）。
    // 警告：不要在 loadAndStart 与本行之间插入任何 await——一旦耗过一个 timer 周期，内置
    // 循环就会抢跑 _retro_run，破坏「帧推进权唯一归属服务端帧循环」的硬约束（#541）。
    host.stop();
    this.host = host;
  }

  public runFrame(held: ReadonlySet<GbaButton>): void {
    const host = this.requireHost();
    // 空按键（idle/gap/settle,绝大多数帧）短路复用常量集合,避免 60/s 的小对象 churn。
    if (held.size === 0) {
      this.heldIds = EMPTY_ID_SET;
    } else {
      const ids = new Set<number>();
      for (const button of held) {
        ids.add(BUTTON_TO_JOYPAD_ID[button]);
      }
      this.heldIds = ids;
    }
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

  public getState(): Buffer | null {
    const host = this.requireHost();
    const size = host.core._retro_serialize_size();
    if (!size) {
      return null;
    }
    const ptr = host.core._malloc(size);
    if (!ptr) {
      return null;
    }
    try {
      if (!host.core._retro_serialize(ptr, size)) {
        return null;
      }
      // slice（非 subarray）拷出 heap：_free 之后 heap 该区域随时被改写。
      return Buffer.from(host.core.HEAPU8.slice(ptr, ptr + size));
    } finally {
      host.core._free(ptr);
    }
  }

  public setState(bytes: Buffer): boolean {
    const host = this.requireHost();
    const ptr = host.core._malloc(bytes.length);
    if (!ptr) {
      return false;
    }
    try {
      host.core.HEAPU8.set(bytes, ptr);
      return Boolean(host.core._retro_unserialize(ptr, bytes.length));
    } finally {
      host.core._free(ptr);
    }
  }

  /**
   * 三大 RAM 区快照（#599）。复用 getState()——不另起一次 `_retro_serialize`，让「核心不支持
   * savestate」这一分支与 getState 天然同语义，也少一次 512KB 级的序列化。
   *
   * 全程同步（无 await）：帧循环是 setTimeout 宏任务，JS 单线程下切不进本函数中间，故这份
   * 快照天然是同一帧的一致视图，不会读到半推进的撕裂状态。
   */
  public readMemory(): GbaMemoryDump | null {
    const state = this.getState();
    if (!state) {
      // 核心不支持 savestate / malloc 失败——是能力缺失而非布局失效，不记 error。
      return null;
    }
    if (state.length < STATE_FIXED_PREFIX_SIZE) {
      logger.error("GBA savestate 短于定长前缀，内存布局假设已失效，拒绝 dump", {
        event: "gba.memory_layout_mismatch",
        reason: "STATE_TOO_SHORT",
        stateBytes: state.length,
        expectedAtLeast: STATE_FIXED_PREFIX_SIZE,
      });
      return null;
    }

    // 交叉校验：**两头都钉**。VRAM 是三段里的第一段、EWRAM 是最后一段，两者都能经 memory id
    // 独立取到（IWRAM 取不到）。只校验 VRAM 是不够的——它位于 IWRAM/EWRAM **之前**，核心若在
    // 它之后插入或改动字段，VRAM 照样匹配而后两段已错位，会静默吐出错位字节。同时校验首尾两
    // 段，则夹在中间的 IWRAM 被两侧锚点钉死：任何能让 IWRAM 起点漂移的改动，必然一并让 EWRAM
    // 起点漂移，会被末段校验抓住。
    const vramFromState = state.subarray(STATE_OFF_VRAM, STATE_OFF_VRAM + STATE_SIZE_VRAM);
    if (!this.matchesLiveRegion(MEMORY_VIDEO_RAM, vramFromState, "VRAM", state.length)) {
      return null;
    }
    const ewramFromState = state.subarray(STATE_OFF_EWRAM, STATE_OFF_EWRAM + STATE_SIZE_EWRAM);
    if (!this.matchesLiveRegion(MEMORY_SYSTEM_RAM, ewramFromState, "EWRAM", state.length)) {
      return null;
    }

    // subarray 而非拷贝：state 已是 getState 拷出的私有副本，三段视图共享它即可，
    // 调用方紧接着就会拼成一个 body，没必要再复制 384KB。
    return {
      ewram: ewramFromState,
      iwram: state.subarray(STATE_OFF_IWRAM, STATE_OFF_IWRAM + STATE_SIZE_IWRAM),
      vram: vramFromState,
    };
  }

  /**
   * 把 savestate 切出的一段与核心经 memory id 直取的同一区逐字节比对，作为布局锚点。
   *
   * 刻意**不校验核心声明的 size**：mGBA 对 SYSTEM_RAM 报的是 IWRAM 的 32KiB（少报 8 倍），
   * 指针却确为 EWRAM 基址——拿声明尺寸把关会永远拒绝。这里只要指针非空且落在 heap 内，就按
   * 我们期望的长度比对内容；内容对得上即证明这段偏移仍然成立，内容不符即拒绝整次 dump。
   */
  private matchesLiveRegion(
    memoryId: number,
    fromState: Buffer,
    regionName: string,
    stateBytes: number,
  ): boolean {
    const host = this.requireHost();
    const heap = host.core.HEAPU8;
    const ptr = host.core._retro_get_memory_data(memoryId);
    if (!ptr || ptr + fromState.length > heap.length) {
      logger.error("GBA 核心的内存区指针异常，无法校验内存布局，拒绝 dump", {
        event: "gba.memory_layout_mismatch",
        reason: "REGION_POINTER_UNUSABLE",
        regionName,
        memoryId,
        ptr,
        expectedBytes: fromState.length,
        heapBytes: heap.length,
      });
      return false;
    }
    const mismatchAt = firstMismatch(fromState, heap.subarray(ptr, ptr + fromState.length));
    if (mismatchAt >= 0) {
      logger.error("GBA savestate 的区段与核心实际内存不符，布局已漂移，拒绝 dump", {
        event: "gba.memory_layout_mismatch",
        reason: "REGION_CONTENT_MISMATCH",
        regionName,
        memoryId,
        mismatchAt,
        stateBytes,
      });
      return false;
    }
    return true;
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

/** 首个不等字节的下标；全等返回 -1。长度不等视作从较短长度处起不等。 */
function firstMismatch(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    return Math.min(a.length, b.length);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return -1;
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
