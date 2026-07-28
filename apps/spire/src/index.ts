import { runService } from "@kagami/kernel/http/service-runner";
import { createHttpLogSinks } from "@kagami/observatory-client/log-sink-factory";
import { buildSpireServiceRuntime } from "./app/spire-service-runtime.js";

// kagami-spire 进程。
// 日志双出口（#608）：stdout 交 PM2 的 spire-out.log 承载，同时经 HttpLogSink 批量上报
// kagami-observatory 落库，供管理台按 service 过滤查询。observatory 不可达时只丢上报那一路。
runService({
  name: "spire_service",
  source: "spire-service-bootstrap",
  logSinks: () => createHttpLogSinks({ service: "spire" }),
  build: async () => {
    const runtime = await buildSpireServiceRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：游戏接口只供本机 agent 调用，绝不对外网卡开放。
      bindHost: "127.0.0.1",
      port: runtime.port,
      // 排空后 flush 存档写队列，SIGTERM 撞上在途写盘也不丢档（issue #274）。
      cleanup: [() => runtime.flushSaves()],
    };
  },
});
