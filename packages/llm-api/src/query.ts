import { z } from "zod";
import { JsonRecordSchema } from "@kagami/http/wire";

/**
 * console 只读查询的 wire schema（epic #539 子 issue 3：console 脱库，llm_chat_call 经本契约查询）。
 *
 * 形状与 @kagami/console-api 的 llm-chat-call response 逐字段对齐（ISO 字符串时间、payload 为
 * JSON record），让 console 侧成为纯转发聚合层：DB Date → ISO 的序列化归 llm handler。
 * 服务间 POST JSON，page/pageSize 是真数字；pageSize 上限与 console-api 的 100 对齐。
 */

export const LlmChatCallQueryStatusSchema = z.enum(["success", "failed"]);

export const LlmQueryChatCallsRequestSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  scene: z.string().min(1).optional(),
  status: LlmChatCallQueryStatusSchema.optional(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});

export type LlmQueryChatCallsRequest = z.infer<typeof LlmQueryChatCallsRequestSchema>;

export const LlmChatCallWireSummarySchema = z.object({
  id: z.number().int().positive(),
  requestId: z.string().min(1),
  seq: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  scene: z.string().min(1).nullable(),
  extension: JsonRecordSchema.nullable(),
  status: LlmChatCallQueryStatusSchema,
  // 与 console-api 的 LlmChatCallSummary 完全同形（无 nonnegative）：output 校验比数据源更严
  // 只会放大整页 500 的风险面，不增加任何保护。
  latencyMs: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});

export type LlmChatCallWireSummary = z.infer<typeof LlmChatCallWireSummarySchema>;

export const LlmQueryChatCallsResponseSchema = z.object({
  total: z.number().int().min(0),
  items: z.array(LlmChatCallWireSummarySchema),
});

export type LlmQueryChatCallsResponse = z.infer<typeof LlmQueryChatCallsResponseSchema>;

export const LlmGetChatCallRequestSchema = z.object({
  id: z.number().int().positive(),
});

export type LlmGetChatCallRequest = z.infer<typeof LlmGetChatCallRequestSchema>;

export const LlmChatCallWireDetailSchema = LlmChatCallWireSummarySchema.extend({
  requestPayload: JsonRecordSchema,
  responsePayload: JsonRecordSchema.nullable(),
  nativeRequestPayload: JsonRecordSchema.nullable(),
  nativeResponsePayload: JsonRecordSchema.nullable(),
  error: JsonRecordSchema.nullable(),
  nativeError: JsonRecordSchema.nullable(),
});

export type LlmChatCallWireDetail = z.infer<typeof LlmChatCallWireDetailSchema>;

/** 未命中时 found: false（不存在的 id 不是错误通道事件，交 console 翻译成自己的 404）。 */
export const LlmGetChatCallResponseSchema = z.union([
  z.object({ found: z.literal(true), item: LlmChatCallWireDetailSchema }),
  z.object({ found: z.literal(false) }),
]);

export type LlmGetChatCallResponse = z.infer<typeof LlmGetChatCallResponseSchema>;
