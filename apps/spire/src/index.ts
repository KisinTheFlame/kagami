import { runService } from "@kagami/kernel/http/service-runner";
import { buildSpireServiceRuntime } from "./app/spire-service-runtime.js";

// kagami-spire 进程：日志只走 stdout（同 browser/llm 卫星进程），由 PM2 的 spire-out.log 承载。
runService({
  name: "spire_service",
  source: "spire-service-bootstrap",
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
