// kagami 本地 stub（issue #541）：真身是 EGL/GLES 原生绑定，仅被 retroemu 的 GL 硬渲核心
// （mupen64plus/beetle_psx_hw 等）在运行期调用；kagami-gba 只跑软渲染的 mgba 核心，任何
// gl.* 调用都不该发生。任何属性访问直接抛错，把「意外走进 GL 路径」变成响亮失败。
const message =
  "[kagami] native-gles 已被 stub（vendor/stubs/native-gles）：kagami-gba 只支持软渲染核心 " +
  "(mgba)，不提供 GL 硬件渲染。若确需 GL 核心，请移除 package.json 的 pnpm override 并恢复原生依赖。";

export default new Proxy(
  {},
  {
    get(_target, prop) {
      // 模块互操作探测（await import / Promise 解包 / console.log）不该炸。
      if (typeof prop === "symbol" || prop === "then" || prop === "default") {
        return undefined;
      }
      throw new Error(`${message}（访问了 gl.${String(prop)}）`);
    },
  },
);
