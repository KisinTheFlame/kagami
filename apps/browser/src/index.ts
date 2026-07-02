import { closeDb } from "@kagami/persistence/db/client";
import { runService } from "@kagami/kernel/http/service-runner";
import { buildBrowserRuntime } from "./app/browser-runtime.js";

// 浏览器进程：日志只走 stdout（不写 app_log，对 DB 只读 browser_credential），
// 请求日志由 PM2 的 browser-out.log 承载。
// 关停强退兜底（runService 的 10s）在这里尤其关键：若有动作（如无超时的 eval）永不 settle，
// app.close() 会一直等活跃请求，到点强退避免 SIGTERM 下 context 不关、进程不退。
runService({
  name: "browser",
  source: "browser-bootstrap",
  build: async () => {
    const runtime = await buildBrowserRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：API 暴露 /type secret / /eval / /screenshot，绝不对外网卡开放
      // （issue #173 安全边界）。
      bindHost: "127.0.0.1",
      port: runtime.port,
      cleanup: [() => runtime.service.shutdown(), () => closeDb(runtime.database)],
      // 预热只下二进制、不开窗，削掉首个动作的延迟。放在 listen 之后后台跑：health 立即可用，
      // 首次下载（可能较慢）不阻塞启动。失败不致命（首动作时 lazy-launch 再降级提示）。
      afterListen: () => {
        void runtime.service.prewarm();
      },
    };
  },
});
