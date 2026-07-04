import { z } from "zod";
import {
  createPaginatedResponseSchema,
  JsonRecordSchema,
  PaginationQuerySchema,
  parseOptionalStringInput,
} from "@kagami/http/wire";

// === llm_chat_call 历史查询的 wire schema（console 服务产出，web 管理台消费） ===
//
// 自旧 shared/schemas/llm-chat 迁入（#279 PR4）。LLM 负载核心 schema
// （LlmChatRequest/ResponsePayload 等）与本段无耦合，归 llm-api（PR5）。

export const LlmChatCallStatusSchema = z.enum(["success", "failed"]);

export type LlmChatCallStatus = z.infer<typeof LlmChatCallStatusSchema>;

export const LlmChatCallListQuerySchema = PaginationQuerySchema.extend({
  provider: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  model: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  status: z.preprocess(parseOptionalStringInput, LlmChatCallStatusSchema.optional()),
  // 时间窗（含端点）：带时区 ISO-8601。供观察台下钻带 from/to 落地明细；单用于 llm-history 页也可。
  // refine 兜底越界 offset（如 `+99:00`）：过 datetime() 却让 new Date 成 Invalid Date，
  // 不拦会流到 service 的 new Date → Prisma 绑定 Invalid Date → 500。
  from: z.preprocess(
    parseOptionalStringInput,
    z
      .string()
      .datetime({ offset: true })
      .refine(value => !Number.isNaN(new Date(value).getTime()), { message: "不是合法时间" })
      .optional(),
  ),
  to: z.preprocess(
    parseOptionalStringInput,
    z
      .string()
      .datetime({ offset: true })
      .refine(value => !Number.isNaN(new Date(value).getTime()), { message: "不是合法时间" })
      .optional(),
  ),
});

export type LlmChatCallListQuery = z.infer<typeof LlmChatCallListQuerySchema>;

export const LlmChatCallSummarySchema = z.object({
  id: z.number().int().positive(),
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  extension: JsonRecordSchema.nullable(),
  status: LlmChatCallStatusSchema,
  latencyMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export type LlmChatCallSummary = z.infer<typeof LlmChatCallSummarySchema>;

export const LlmChatCallItemSchema = LlmChatCallSummarySchema.extend({
  requestPayload: JsonRecordSchema,
  responsePayload: JsonRecordSchema.nullable(),
  nativeRequestPayload: JsonRecordSchema.nullable(),
  nativeResponsePayload: JsonRecordSchema.nullable(),
  error: JsonRecordSchema.nullable(),
  nativeError: JsonRecordSchema.nullable(),
});

export type LlmChatCallItem = z.infer<typeof LlmChatCallItemSchema>;

export const LlmChatCallListResponseSchema =
  createPaginatedResponseSchema(LlmChatCallSummarySchema);

export type LlmChatCallListResponse = z.infer<typeof LlmChatCallListResponseSchema>;

export const LlmChatCallDetailResponseSchema = LlmChatCallItemSchema;

export type LlmChatCallDetailResponse = z.infer<typeof LlmChatCallDetailResponseSchema>;
