import { closeDb } from "./infra/db/client.js";
import { runService } from "@kagami/kernel/http/service-runner";
import { buildNapcatRuntime } from "./app/napcat-runtime.js";

// napcat 进程（kagami-napcat，issue #347）：独立 PM2 进程持有到 NapCat 的 WS 长连接，agent 重启
// 不打断它。日志只走 stdout（请求日志由 PM2 的 napcat-out.log 承载）。
runService({
  name: "napcat",
  source: "napcat-bootstrap",
  build: async () => {
    const runtime = await buildNapcatRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：只有 agent（出站 RPC + SSE 订阅）在同机 reach 它，绝不对外。
      bindHost: "127.0.0.1",
      port: runtime.port,
      // 关停：先结束活 SSE 连接（否则 keep-alive 长连接让 app.close 挂到强退超时，issue #425）+
      // 停网关（关 WS），cleanup 再停 prune、关 DB。
      beforeClose: [() => runtime.closeSubscribers(), () => runtime.gateway.stop()],
      cleanup: [() => runtime.stopPrune(), () => closeDb(runtime.database)],
      // WS 连接在 listen 之后建立：health 立即可用，NapCat 连接（可能重试）不阻塞启动。
      afterListen: () => {
        void runtime.gateway.start();
      },
    };
  },
});
