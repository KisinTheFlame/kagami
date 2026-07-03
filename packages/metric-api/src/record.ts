import { z } from "zod";

/**
 * Metric 摄取端点（`POST /metric/record`）的请求契约。agent 侧 HTTP 客户端与
 * `@kagami/metric` 服务端共用这一份，保证线上字节形状一致。
 *
 * 校验权威在服务端：值类型 / metricName 非空 / value 有限 / occurredAt 带时区都在这里，
 * 但「tag key 去空白后不能为空」这条 zod record 天然做不到，留服务端 normalizeTags 兜。
 */
export const RecordMetricRequestSchema = z.object({
  metricName: z.string().trim().min(1),
  value: z.number().finite(),
  tags: z.record(z.string(), z.string()).optional(),
  // 必须是带时区的 ISO 8601（`Z` 或 `+08:00`）；裸本地时间（无时区）拒收。
  // datetime() 只挡明显越界，越界 offset（如 `+99:00`）能过它却让 `new Date` 产出 Invalid
  // Date——refine 兜底，让这类输入落 400，而不是流到服务端 `new Date` → Prisma insert 崩 500。
  occurredAt: z
    .string()
    .datetime({ offset: true })
    .refine(value => !Number.isNaN(new Date(value).getTime()), {
      message: "occurredAt 不是合法时间",
    })
    .optional(),
});

export type RecordMetricRequest = z.infer<typeof RecordMetricRequestSchema>;

export const RecordMetricResponseSchema = z.object({
  ok: z.literal(true),
});

export type RecordMetricResponse = z.infer<typeof RecordMetricResponseSchema>;
