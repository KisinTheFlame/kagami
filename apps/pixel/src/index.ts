import { runService } from "@kagami/kernel/http/service-runner";
import { createHttpLogSinks } from "@kagami/observatory-client/log-sink-factory";
import { buildPixelServiceRuntime } from "./app/pixel-service-runtime.js";

// kagami-pixel 进程。
// 日志双出口（#608）：stdout 交 PM2 的 pixel-out.log 承载，同时经 HttpLogSink 批量上报
// kagami-observatory 落库，供管理台按 service 过滤查询。observatory 不可达时只丢上报那一路。
runService({
  name: "pixel_service",
  source: "pixel-service-bootstrap",
  logSinks: () => createHttpLogSinks({ service: "pixel" }),
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
