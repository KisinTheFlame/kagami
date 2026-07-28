import { runService } from "@kagami/kernel/http/service-runner";
import { createHttpLogSinks } from "@kagami/observatory-client/log-sink-factory";
import { buildSchedulerRuntime, closeDb } from "./app/scheduler-runtime.js";

// scheduler 进程（kagami-scheduler，issue #428）：通用薄时钟 + 执行历史存储（TaskRun，#493）。
// 独立 PM2 进程，agent 重启不打断它。
// 日志双出口（#608）：stdout 交 PM2 的 scheduler-out.log 承载，同时经 HttpLogSink 批量上报
// kagami-observatory 落库，供管理台按 service 过滤查询。observatory 不可达时只丢上报那一路。
runService({
  name: "scheduler",
  source: "scheduler-bootstrap",
  logSinks: () => createHttpLogSinks({ service: "scheduler" }),
  build: async () => {
    const runtime = await buildSchedulerRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：只有使用方（agent）在同机 reach 它，绝不对外。
      bindHost: "127.0.0.1",
      port: runtime.port,
      // 关停：停掉所有 driver（in-flight handler 在使用方进程，与本引擎无关）+ 停历史 GC + 断库连接。
      cleanup: [
        () => runtime.engine.stop(),
        () => runtime.stopHistoryGc(),
        () => closeDb(runtime.database),
      ],
    };
  },
});
