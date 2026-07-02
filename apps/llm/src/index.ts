import { closeDb } from "@kagami/persistence/db/client";
import { runService } from "@kagami/kernel/http/service-runner";
import { buildLlmServiceRuntime } from "./app/llm-service-runtime.js";

// kagami-llm 进程：日志只走 stdout（同 browser/oss 卫星进程），请求日志由 PM2 的
// llm-out.log 承载。对 DB 的写只有 llm_chat_call / auth 表 / embedding_cache（数据，非日志）。
runService({
  name: "llm_service",
  source: "llm-service-bootstrap",
  build: async () => {
    const runtime = await buildLlmServiceRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1：/internal/* 与 /auth/* 只供本机 agent / gateway 调用，绝不对外网卡开放。
      bindHost: "127.0.0.1",
      port: runtime.port,
      cleanup: [
        () => runtime.authRefreshTimers.stop(),
        async () => {
          await Promise.all(runtime.callbackServers.map(server => server.stop()));
        },
        () => closeDb(runtime.database),
      ],
    };
  },
});
