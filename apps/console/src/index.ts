import { runService } from "@kagami/kernel/http/service-runner";
import { buildConsoleRuntime } from "./app/console-runtime.js";

// console 是只读查询聚合进程（#539 起零 DB 依赖）：日志只走 stdout（不写 app_log），
// 自身请求日志由 PM2 的 console-out.log 承载即可。
// 监听端口来自 config.yaml 的 services.console.port（由 buildConsoleRuntime 读出），
// 不再走 PM2 注入的 PORT env——服务寻址单一事实来源见 issue #162。
runService({
  name: "console",
  source: "console-bootstrap",
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
