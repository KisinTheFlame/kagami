import { runService } from "@kagami/kernel/http/service-runner";
import { buildGbaServiceRuntime } from "./app/gba-service-runtime.js";

// kagami-gba 进程：日志只走 stdout（同 spire/pixel 卫星进程），由 PM2 的 gba-out.log 承载。
runService({
  name: "gba_service",
  source: "gba-service-bootstrap",
  build: async () => {
    const runtime = await buildGbaServiceRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：游玩接口只供本机 agent / gateway 调用，绝不对外网卡开放。
      bindHost: "127.0.0.1",
      port: runtime.port,
      // 排空：中止在途 press、flush 电池存档、释放 WASM 核心、关库。SIGTERM 撞上在途写盘也不丢档。
      cleanup: [() => runtime.shutdown()],
    };
  },
});
