import { runService } from "@kagami/kernel/http/service-runner";
import { createHttpLogSinks } from "@kagami/observatory-client/log-sink-factory";
import { buildBrowserRuntime } from "./app/browser-runtime.js";

// 浏览器进程（零持久化，不碰任何 DB）。
// 日志双出口（#608）：stdout 交 PM2 的 browser-out.log 承载，同时经 HttpLogSink 批量上报
// kagami-observatory 落库，供管理台按 service 过滤查询。observatory 不可达时只丢上报那一路。
// 请求日志由 PM2 的 browser-out.log 承载。
// 关停强退兜底（runService 的 10s）在这里尤其关键：若有动作（如无超时的 eval）永不 settle，
// app.close() 会一直等活跃请求，到点强退避免 SIGTERM 下 context 不关、进程不退。
runService({
  name: "browser",
  source: "browser-bootstrap",
  logSinks: () => createHttpLogSinks({ service: "browser" }),
  build: async () => {
    const runtime = await buildBrowserRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：API 暴露 /type secret / /eval / /screenshot，绝不对外网卡开放
      // （issue #173 安全边界）。
      bindHost: "127.0.0.1",
      port: runtime.port,
      cleanup: [() => runtime.service.shutdown()],
      // 预热只下二进制、不开窗，削掉首个动作的延迟。放在 listen 之后后台跑：health 立即可用，
      // 首次下载（可能较慢）不阻塞启动。失败不致命（首动作时 lazy-launch 再降级提示）。
      afterListen: () => {
        void runtime.service.prewarm();
      },
    };
  },
});
