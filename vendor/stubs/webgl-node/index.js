// kagami 本地 stub（issue #541）：真身基于 native-gles 提供 WebGL2 上下文，仅被 retroemu 的
// canvas 型 GL 核心（parallel_n64/beetle_psx_hw/flycast）调用；kagami-gba 只跑软渲染的 mgba
// 核心。LibretroHost 顶层静态 import 本包，所以导入必须成功——调用才抛错。
const message =
  "[kagami] webgl-node 已被 stub（vendor/stubs/webgl-node）：kagami-gba 只支持软渲染核心 " +
  "(mgba)，不提供 GL 硬件渲染。若确需 GL 核心，请移除 package.json 的 pnpm override 并恢复原生依赖。";

export function createWebGL2Context() {
  throw new Error(message);
}

export class WebGL2RenderingContext {
  constructor() {
    throw new Error(message);
  }
}
