import { defineJsonRoute } from "@kagami/http/contract";
import { RaiseAlertRequestSchema, RaiseAlertResponseSchema } from "./alert.js";
import {
  IngestLogsRequestSchema,
  IngestLogsResponseSchema,
  QueryLogsRequestSchema,
  QueryLogsResponseSchema,
} from "./log.js";

/**
 * kagami-observatory 进程的对外契约（issue #602 告警 + #608 日志）。
 *
 * 定位：**可观测性能力**。任何服务都能调，observatory 不认识调用方的领域——
 * - 告警：渲染 → 按 (source, event) 去重限流 → 投递到 QQ 告警群。零 DB，去重窗口纯内存。
 * - 日志：批量摄取 → 落自己的独占 SQLite 库（`app_log`）→ 供 console 分页查询（#608）。
 *
 * 只绑 127.0.0.1。告警与摄取是服务间内部路由，浏览器经 gateway 够不到；日志查询由 console
 * 转发聚合（gateway 的 `/app-log` 前缀仍指向 console，前门形状不变）。
 *
 * 名字消歧：本进程与此前那个已 revert 的「LLM 行为观察台」前端页面（#371 / #408）无关。
 * #602 立名时写的「将来可能汇聚 metric 与日志」，日志这半在 #608 兑现。
 *
 * 类型走显式子路径 `@kagami/observatory-api/{alert,log}`，本文件不做 re-export（无 barrel）。
 */
export const observatoryApiContract = {
  raiseAlert: defineJsonRoute({
    method: "POST",
    path: "/observatory/alert",
    input: RaiseAlertRequestSchema,
    output: RaiseAlertResponseSchema,
  }),
  ingestLogs: defineJsonRoute({
    method: "POST",
    path: "/observatory/logs",
    input: IngestLogsRequestSchema,
    output: IngestLogsResponseSchema,
  }),
  queryLogs: defineJsonRoute({
    method: "POST",
    path: "/observatory/logs/query",
    input: QueryLogsRequestSchema,
    output: QueryLogsResponseSchema,
  }),
};
