import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";
import {
  MetricChartCreateRequestSchema,
  MetricChartCreateResponseSchema,
  MetricChartDataQuerySchema,
  MetricChartDataResponseSchema,
  MetricChartDeleteRequestSchema,
  MetricChartDeleteResponseSchema,
  MetricChartListResponseSchema,
} from "./chart.js";
import { RecordMetricRequestSchema, RecordMetricResponseSchema } from "./record.js";

// === @kagami/metric-api：kagami-metric 服务的 HTTP 契约（issue #279 PR3） ===
//
// 两类消费者：
// - record：agent 的 fire-and-forget 打点客户端。注意 agent 侧刻意**不走 createClient**——
//   其 2s 超时、非 2xx 只 warn、不读响应体、一切失败静默吞的语义与通用 client 不同；
//   它只从这里取 path 与请求类型（单一事实源仍然成立）。
// - chart 四条：web 管理台经 gateway 消费（contractUrl 取 path/schema，fetch 层不变）。

export const metricApiContract = {
  record: defineJsonRoute({
    method: "POST",
    path: "/metric/record",
    input: RecordMetricRequestSchema,
    output: RecordMetricResponseSchema,
  }),
  listCharts: defineJsonRoute({
    method: "GET",
    path: "/metric-chart/list",
    // strict：多余 query 参数按 400 拒收（沿袭旧 registerQueryRoute 的 EmptyQuerySchema 行为）。
    input: z.object({}).strict(),
    output: MetricChartListResponseSchema,
  }),
  chartData: defineJsonRoute({
    method: "GET",
    path: "/metric-chart/data",
    input: MetricChartDataQuerySchema,
    output: MetricChartDataResponseSchema,
  }),
  createChart: defineJsonRoute({
    method: "POST",
    path: "/metric-chart/create",
    input: MetricChartCreateRequestSchema,
    output: MetricChartCreateResponseSchema,
  }),
  deleteChart: defineJsonRoute({
    method: "POST",
    path: "/metric-chart/delete",
    input: MetricChartDeleteRequestSchema,
    output: MetricChartDeleteResponseSchema,
  }),
} as const;
