import { runService } from "@kagami/kernel/http/service-runner";
import { createHttpLogSinks } from "@kagami/observatory-client/log-sink-factory";
import { buildMetricRuntime } from "./app/metric-runtime.js";

// metric 是独立的 metric 领域进程（自身有独占 DuckDB 库，不碰共享 DB）。
// 日志双出口（#608）：stdout 交 PM2 的 metric-out.log 承载，同时经 HttpLogSink 批量上报
// kagami-observatory 落库，供管理台按 service 过滤查询。observatory 不可达时只丢上报那一路。
// 自身请求日志由 PM2 的 metric-out.log 承载即可。
// 监听端口来自 config.yaml 的 services.metric.port（由 buildMetricRuntime 读出），
// 不走 PM2 注入的 PORT env——服务寻址单一事实来源见 issue #162。
runService({
  name: "metric",
  source: "metric-bootstrap",
  logSinks: () => createHttpLogSinks({ service: "metric" }),
  build: async () => {
    const runtime = await buildMetricRuntime();
    return {
      app: runtime.app,
      // 仅绑 127.0.0.1（同 oss / browser）：摄取端点无鉴权，绝不能暴露到其它网卡。
      bindHost: "127.0.0.1",
      port: runtime.port,
      cleanup: [() => runtime.close()],
    };
  },
});
