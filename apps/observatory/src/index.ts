import { runService } from "@kagami/kernel/http/service-runner";
import { buildObservatoryServiceRuntime, closeDb } from "./app/observatory-service-runtime.js";

// kagami-observatory 进程：告警投递（#602）+ 全服务日志汇聚（#608）。
//
// 本进程**不接** logSinks：它持有 app_log 表，自身日志由 runtime 里的 DbLogSink 直写本地库，
// 绝不 HTTP 打回自己。stdout 那一路仍在（PM2 的 observatory-out.log），是 DB 出问题时的兜底。
runService({
  name: "observatory_service",
  source: "observatory-service-bootstrap",
  build: async () => {
    const runtime = await buildObservatoryServiceRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：告警上报与日志摄取只供本机服务调用，绝不对外网卡开放。
      bindHost: "127.0.0.1",
      port: runtime.port,
      // 关停顺序有讲究：停清理定时器 → 排空自身日志队列 → 最后才断库连接。closeDb 提前一步
      // 就会让最后一批日志写到已断开的 client 上。
      cleanup: [
        () => runtime.stopPrune(),
        () => runtime.closeLogSink(),
        () => closeDb(runtime.database),
      ],
    };
  },
});
