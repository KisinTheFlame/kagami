import { z } from "zod";
import { JsonRecordSchema } from "@kagami/http/wire";

/**
 * 日志级别。与 `@kagami/kernel` 的 `LogLevel` 逐字对齐——这条 wire 是 kernel logger 的搬运通道，
 * 两侧词汇必须一致，否则每条日志都要翻译一次。
 */
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error", "fatal"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * 一条待摄取的日志。
 *
 * `createdAt` 由**产出进程**盖戳（kernel `LogEvent.createdAt`），不是 observatory 的到达时间：
 * sink 攒批最长 1s、网络还会抖，用到达时间会让跨进程按时间排序失真。
 *
 * `message` 刻意不加 `.min(1)`：空 message 是调用方的低级失误，不值得让整批日志被 400 退回。
 */
export const IngestLogItemSchema = z
  .object({
    traceId: z.string().min(1),
    level: LogLevelSchema,
    message: z.string(),
    metadata: JsonRecordSchema,
    createdAt: z.string().datetime(),
  })
  .strict();
export type IngestLogItem = z.infer<typeof IngestLogItemSchema>;

/**
 * 批量摄取。`service` 是**进程**标识（agent / console / napcat / …），与 `metadata.source`
 * 的**模块**标识是两个维度——挤进同一个字段就会复现 #602 那个「告警的 source 覆盖模块名」的
 * 缺陷（commit d973d250）。
 *
 * `items` 上限 500：sink 侧 batchSize 是 100，5 倍余量足够，同时挡住畸形的巨批请求。
 */
export const IngestLogsRequestSchema = z
  .object({
    service: z.string().min(1),
    items: z.array(IngestLogItemSchema).min(1).max(500),
  })
  .strict();
export type IngestLogsRequest = z.infer<typeof IngestLogsRequestSchema>;

/** 摄取回执。只回落库条数——调用方是 fire-and-forget 的 sink，拿不到也不会重试。 */
export const IngestLogsResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
});
export type IngestLogsResponse = z.infer<typeof IngestLogsResponseSchema>;

/**
 * 日志查询。消费者是 console（管理台聚合层），不是浏览器直连。
 *
 * 两个容易混的过滤维度：`service` = 哪个进程产出的（精确匹配），`source` = 进程里哪个模块
 * （`metadata ->> 'source'` 模糊匹配，沿用旧行为）。
 */
export const QueryLogsRequestSchema = z
  .object({
    service: z.string().min(1).optional(),
    level: LogLevelSchema.optional(),
    traceId: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(100),
  })
  .strict();
export type QueryLogsRequest = z.infer<typeof QueryLogsRequestSchema>;

export const LogWireItemSchema = z.object({
  id: z.number().int().positive(),
  service: z.string().min(1),
  traceId: z.string().min(1),
  level: LogLevelSchema,
  message: z.string(),
  metadata: JsonRecordSchema,
  createdAt: z.string().datetime(),
});
export type LogWireItem = z.infer<typeof LogWireItemSchema>;

export const QueryLogsResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(LogWireItemSchema),
});
export type QueryLogsResponse = z.infer<typeof QueryLogsResponseSchema>;
