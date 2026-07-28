import { runService } from "@kagami/kernel/http/service-runner";
import { createHttpLogSinks } from "@kagami/observatory-client/log-sink-factory";
import { buildConsoleRuntime } from "./app/console-runtime.js";

// console 是只读查询聚合进程（#539 起零 DB 依赖）。
// 日志双出口（#608）：stdout 交 PM2 的 console-out.log 承载，同时经 HttpLogSink 批量上报
// kagami-observatory 落库，供管理台按 service 过滤查询。observatory 不可达时只丢上报那一路。
// 监听端口来自 config.yaml 的 services.console.port（由 buildConsoleRuntime 读出），
// 不再走 PM2 注入的 PORT env——服务寻址单一事实来源见 issue #162。
runService({
  name: "console",
  source: "console-bootstrap",
  logSinks: () => createHttpLogSinks({ service: "console" }),
  build: async () => {
    const runtime = await buildConsoleRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：console 是只读查询后端，前端流量一律经 gateway 反代进来，
      // 绝不对外网卡开放（issue #274）。
      bindHost: "127.0.0.1",
      port: runtime.port,
      cleanup: [],
    };
  },
});
