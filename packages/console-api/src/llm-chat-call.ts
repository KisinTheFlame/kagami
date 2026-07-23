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
  scene: z.preprocess(parseOptionalStringInput, z.string().min(1).optional()),
  status: z.preprocess(parseOptionalStringInput, LlmChatCallStatusSchema.optional()),
});

export type LlmChatCallListQuery = z.infer<typeof LlmChatCallListQuerySchema>;

export const LlmChatCallSummarySchema = z.object({
  id: z.number().int().positive(),
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  scene: z.string().min(1).nullable(),
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
