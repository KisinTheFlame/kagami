import { runService } from "@kagami/kernel/http/service-runner";
import { buildSchedulerRuntime } from "./app/scheduler-runtime.js";

// scheduler 进程（kagami-scheduler，issue #428）：通用薄时钟。独立 PM2 进程，agent 重启不打断它。
// 日志只走 stdout（请求日志由 PM2 的 scheduler-out.log 承载）。无 DB、无业务语义。
runService({
  name: "scheduler",
  source: "scheduler-bootstrap",
  build: async () => {
    const runtime = await buildSchedulerRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：只有使用方（agent）在同机 reach 它，绝不对外。
      bindHost: "127.0.0.1",
      port: runtime.port,
      // 关停：停掉所有 driver（in-flight handler 在使用方进程，与本引擎无关）。
      cleanup: [() => runtime.engine.stop()],
    };
  },
});
