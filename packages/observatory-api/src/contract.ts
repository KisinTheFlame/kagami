import { defineJsonRoute } from "@kagami/http/contract";
import { RaiseAlertRequestSchema, RaiseAlertResponseSchema } from "./alert.js";

/**
 * kagami-observatory 进程的对外契约（issue #602）。
 *
 * 定位：**告警能力**。任何服务都能调，observatory 不认识调用方的领域——它只做「渲染 → 按
 * (source, event) 去重限流 → 投递到 QQ 告警群」。零 DB、只绑 127.0.0.1、不过 gateway。
 *
 * 名字消歧：本进程与此前那个已 revert 的「LLM 行为观察台」前端页面（#371 / #408）无关。
 * 名字按终局取（将来可能汇聚 metric 与日志长成可观测性平台），v1 只做告警投递。
 *
 * 类型走显式子路径 `@kagami/observatory-api/alert`，本文件不做 re-export（无 barrel）。
 */
export const observatoryApiContract = {
  raiseAlert: defineJsonRoute({
    method: "POST",
    path: "/observatory/alert",
    input: RaiseAlertRequestSchema,
    output: RaiseAlertResponseSchema,
  }),
};
