import { defineJsonRoute } from "@kagami/http/contract";
import { MetricChartQueryRequestSchema, MetricChartQueryResponseSchema } from "./chart.js";
import { MetricDeriveRequestSchema } from "./derive.js";
import { MetricPointsQueryRequestSchema, MetricPointsQueryResponseSchema } from "./points.js";
import { RecordMetricRequestSchema, RecordMetricResponseSchema } from "./record.js";

// === @kagami/metric-api：kagami-metric 服务的 HTTP 契约（issue #279 PR3 / #444） ===
//
// 两类消费者：
// - record：agent 的 fire-and-forget 打点客户端。注意 agent 侧刻意**不走 createClient**——
//   其 2s 超时、非 2xx 只 warn、不读响应体、一切失败静默吞的语义与通用 client 不同；
//   它只从这里取 path 与请求类型（单一事实源仍然成立）。
// - query：web 前端的可复用 <MetricChart> 组件经 gateway 消费（contractUrl 取 path/schema，
//   apiPostWithSchema 发请求）。图表定义已迁回代码，入参是内联聚合规格，无 chartName / CRUD。

export const metricApiContract = {
  record: defineJsonRoute({
    method: "POST",
    path: "/metric/record",
    input: RecordMetricRequestSchema,
    output: RecordMetricResponseSchema,
  }),
  query: defineJsonRoute({
    method: "POST",
    path: "/metric/query",
    input: MetricChartQueryRequestSchema,
    output: MetricChartQueryResponseSchema,
  }),
  // 派生查询（#475 P3）：分子/分母两份规格算 ratio/diff，出单条派生线（复用 query 的整洁序列响应）。
  derive: defineJsonRoute({
    method: "POST",
    path: "/metric/derive",
    input: MetricDeriveRequestSchema,
    output: MetricChartQueryResponseSchema,
  }),
  // raw 原始点查询：低频 gauge 不聚合、不分桶，按 occurred_at 返回范围内每个原始点，行数 LIMIT 兜底。
  points: defineJsonRoute({
    method: "POST",
    path: "/metric/points",
    input: MetricPointsQueryRequestSchema,
    output: MetricPointsQueryResponseSchema,
  }),
} as const;
