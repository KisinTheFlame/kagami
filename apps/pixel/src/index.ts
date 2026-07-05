import { runService } from "@kagami/kernel/http/service-runner";
import { buildPixelServiceRuntime } from "./app/pixel-service-runtime.js";

// kagami-pixel 进程：日志只走 stdout（同 spire/browser 卫星进程），由 PM2 的 pixel-out.log 承载。
runService({
  name: "pixel_service",
  source: "pixel-service-bootstrap",
  build: async () => {
    const runtime = await buildPixelServiceRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：像素画接口只供本机 agent 调用，绝不对外网卡开放。
      bindHost: "127.0.0.1",
      port: runtime.port,
      // 排空后 flush 存档写队列，SIGTERM 撞上在途写盘也不丢档。
      cleanup: [() => runtime.flushSaves()],
    };
  },
});
