/**
 * retroemu（MIT，libretro WASM 宿主）的最小 ambient 声明——上游是纯 JS 无类型。只声明本服务
 * 用到的表面：LibretroHost 构造注入 + loadAndStart/stop/shutdown + core 模块的 libretro 导出。
 * mGBA 核心 WASM 由 romdev-platform-gba 包提供（retroemu CoreLoader 内部解析，pin 精确版本）。
 *
 * 刻意用**子路径**而非包根：包根 index.js 会拖进 @kmamal/sdl（音频/手柄原生绑定）；LibretroHost
 * 自身只静态触达 webgl-node / native-gles，二者已被 vendor/stubs 覆盖（根 package.json 的
 * pnpm overrides），headless 安装零原生构建。
 */
declare module "retroemu/src/core/LibretroHost.js" {
  /** Emscripten 编译的 libretro 核心模块（本服务用到的导出子集）。 */
  export interface LibretroCoreModule {
    HEAPU8: Uint8Array;
    _retro_run(): void;
    /** RETRO_MEMORY_SAVE_RAM = 0；返回 WASM heap 内指针（0 = 无此内存区）。 */
    _retro_get_memory_data(memoryType: number): number;
    _retro_get_memory_size(memoryType: number): number;
  }

  export interface RetroemuVideoOutput {
    onFrame(
      mod: LibretroCoreModule,
      dataPtr: number,
      width: number,
      height: number,
      pitch: number,
      pixelFormat: number,
    ): void;
    onCartFrameRGBA(pixels: Uint8Array, width: number, height: number): void;
    setAspectRatio(aspectRatio: number): void;
  }

  export interface RetroemuAudioBridge {
    init(sampleRate: number): Promise<void>;
    onAudioBatch(mod: LibretroCoreModule, dataPtr: number, frames: number): number;
    onAudioSample(left: number, right: number): void;
    destroy(): void;
  }

  export interface RetroemuInputManager {
    poll(): void;
    getState(port: number, device: number, index: number, id: number): number;
  }

  export interface RetroemuSaveManager {
    loadSRAM(core: LibretroCoreModule, romPath: string): Promise<void>;
    saveSRAM(core: LibretroCoreModule, romPath: string, silent?: boolean): Promise<void>;
    saveState(core: LibretroCoreModule, romPath: string, slot?: number): Promise<void>;
    loadState(core: LibretroCoreModule, romPath: string, slot?: number): Promise<void>;
  }

  export class LibretroHost {
    constructor(deps: {
      videoOutput: RetroemuVideoOutput;
      audioBridge: RetroemuAudioBridge;
      inputManager: RetroemuInputManager;
      saveManager: RetroemuSaveManager;
    });
    core: LibretroCoreModule;
    coreName: string;
    systemAVInfo: { timing: { fps: number } } | undefined;
    loadAndStart(
      romPath: string,
      opts?: { systemDir?: string; saveDir?: string; romData?: Uint8Array },
    ): Promise<void>;
    stop(): void;
    shutdown(): Promise<void>;
  }
}
