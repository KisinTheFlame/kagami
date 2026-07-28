import { runService } from "@kagami/kernel/http/service-runner";
import { createHttpLogSinks } from "@kagami/observatory-client/log-sink-factory";
import { buildGbaServiceRuntime } from "./app/gba-service-runtime.js";

// kagami-gba 进程。
// 日志双出口（#608）：stdout 交 PM2 的 gba-out.log 承载，同时经 HttpLogSink 批量上报
// kagami-observatory 落库，供管理台按 service 过滤查询。observatory 不可达时只丢上报那一路。
runService({
  name: "gba_service",
  source: "gba-service-bootstrap",
  logSinks: () => createHttpLogSinks({ service: "gba" }),
  build: async () => {
    const runtime = await buildGbaServiceRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：游玩接口只供本机 agent / gateway 调用，绝不对外网卡开放。
      bindHost: "127.0.0.1",
      port: runtime.port,
      // 排空：中止在途 press、flush 电池存档、落无感重启快照、释放 WASM 核心、关库。
      // SIGTERM 撞上在途写盘也不丢档；下次启动 unserialize 接续停机现场。
      cleanup: [() => runtime.shutdown()],
    };
  },
});
