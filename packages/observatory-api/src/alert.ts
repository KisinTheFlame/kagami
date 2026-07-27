import { z } from "zod";

/**
 * 告警等级。三档对齐 `@kagami/kernel` 的 `LogLevel` 词汇（warn / error / fatal），让「日志里
 * 什么级别」和「告警里什么级别」不用二次翻译。
 *
 * 这里用 `z.enum` 不是对内部代码加白名单防御，而是因为它是 HTTP wire 边界、且要顺带产出
 * TS 联合类型给渲染层穷举。v1 只影响渲染前缀，但它是**必填**字段——将来运维中枢要按级别分流
 * 路由时补不上（给已存在的契约加必填字段等于破契约）。
 */
export const AlertSeveritySchema = z.enum(["warn", "error", "fatal"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

/**
 * 一次告警上报。observatory **不认识任何调用方的领域词汇**：调用方自报「我是谁 / 什么事 /
 * 多严重 / 一行摘要」，observatory 只负责渲染、去重限流、投递。
 *
 * 字段长度不设上限：内部服务之间不堆防御，过长的 detail 由渲染层截断（见服务侧
 * `renderAlertMessage`）。
 */
export const RaiseAlertRequestSchema = z
  .object({
    /** 上报方服务名（agent / napcat / llm / …）。与 event 一起构成去重分组键。 */
    source: z.string().min(1),
    /** 机器可读的告警类型键，如 "react.no_tool_stall"。同一 (source, event) 共用一个去重窗口。 */
    event: z.string().min(1),
    severity: AlertSeveritySchema,
    /** 一行人读摘要。 */
    title: z.string().min(1),
    /** 可选多行细节；渲染时按 Unicode 码点截断。 */
    detail: z.string().optional(),
    /** 可选扁平上下文，渲染成 `key: value` 行。 */
    context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();
export type RaiseAlertRequest = z.infer<typeof RaiseAlertRequestSchema>;

/**
 * 上报回执。三种结局用两个布尔表达：
 * - `{ delivered: true,  suppressed: false }` 投递成功
 * - `{ delivered: false, suppressed: true  }` 被去重窗口压制
 * - `{ delivered: false, suppressed: false }` 通道失败（napcat 不可达 / 返错）
 *
 * 通道失败仍回 HTTP 200：那不是调用方的错，调用方也**不该重试**（重试只会加重对下游的压力）。
 * 非 2xx 只留给「请求本身不合契约」。
 */
export const RaiseAlertResponseSchema = z.object({
  delivered: z.boolean(),
  suppressed: z.boolean(),
});
export type RaiseAlertResponse = z.infer<typeof RaiseAlertResponseSchema>;
