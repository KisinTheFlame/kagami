import { runService } from "@kagami/kernel/http/service-runner";
import { buildObservatoryServiceRuntime } from "./app/observatory-service-runtime.js";

// kagami-observatory 进程：日志只走 stdout（同 pixel/spire/browser 卫星进程），由 PM2 的
// observatory-out.log 承载。零 DB、无关停清理动作。
runService({
  name: "observatory_service",
  source: "observatory-service-bootstrap",
  build: async () => {
    const runtime = await buildObservatoryServiceRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：告警上报只供本机服务调用，绝不对外网卡开放。
      bindHost: "127.0.0.1",
      port: runtime.port,
    };
  },
});
