import { z } from "zod";
import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "@kagami/http/wire";

export const AppLogLevelSchema = z.enum(["debug", "info", "warn", "error", "fatal"]);

export type AppLogLevel = z.infer<typeof AppLogLevelSchema>;

export const AppLogListQuerySchema = PaginationQuerySchema.extend({
  // 产出日志的**进程**（agent / console / napcat / …），精确匹配。自 #608 起全服务日志汇聚到
  // observatory，这个维度才有意义；它与 `source`（进程内的模块名，模糊匹配）是两回事。
  service: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  level: z.preprocess(parseOptionalStringInput, AppLogLevelSchema.optional()),
  traceId: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  message: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  source: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  startAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
  endAt: z.preprocess(parseOptionalStringInput, z.string().datetime().optional()),
}).superRefine((value, ctx) => {
  if (!value.startAt || !value.endAt) {
    return;
  }

  if (new Date(value.startAt).getTime() > new Date(value.endAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startAt"],
      message: "startAt must be less than or equal to endAt",
    });
  }
});

export type AppLogListQuery = z.infer<typeof AppLogListQuerySchema>;

export const AppLogItemSchema = z.object({
  id: z.number().int().positive(),
  service: z.string().min(1),
  traceId: z.string().min(1),
  level: AppLogLevelSchema,
  // 不加 .min(1)：与 observatory 摄取契约一致（空 message 是调用方失误，不该让整页查询 500）。
  message: z.string(),
  metadata: JsonRecordSchema,
  createdAt: z.string().datetime(),
});

export type AppLogItem = z.infer<typeof AppLogItemSchema>;

export const AppLogListResponseSchema = createPaginatedResponseSchema(AppLogItemSchema);

export type AppLogListResponse = z.infer<typeof AppLogListResponseSchema>;
