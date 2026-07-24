import { z } from "zod";
import type {
  LlmContentPart,
  LlmImageContentPart,
  LlmMessage,
  LlmTextContentPart,
  LlmThinkingBlock,
  LlmToolCall,
} from "@kagami/llm-client";

const DateValueSchema = z.coerce.date();
const JsonRecordSchema = z.record(z.string(), z.unknown());
// 图片内容现为 base64 字符串。恢复期永不拒绝（含被 JSON 毒过的旧快照里
// {type:"Buffer",data:[...]} 残骸——z.string() 强校验会让旧中毒快照恢复失败、丢上下文）。
// 对象形态的恢复兜底在两个下游消费点用 imageContentToBase64 完成：provider 发送映射、
// client 记录侧；中毒对象随上下文压缩自然老化。
const ImageContentSchema = z.custom<string>(() => true);

const LlmTextContentPartSchema: z.ZodType<LlmTextContentPart> = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const LlmImageContentPartSchema: z.ZodType<LlmImageContentPart> = z.object({
  type: z.literal("image"),
  content: ImageContentSchema,
  mimeType: z.string(),
  filename: z.string().optional(),
});

const LlmContentPartSchema: z.ZodType<LlmContentPart> = z.union([
  LlmTextContentPartSchema,
  LlmImageContentPartSchema,
]);

const LlmToolCallSchema: z.ZodType<LlmToolCall> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: JsonRecordSchema,
});

// thinking 块（#573）不透明存储原样回放：zod 默认 strip 未知键，不加这条恢复期会把
// 快照里的 thinking 块静默剥掉——崩溃恢复若落在 tool loop 中段，缺块续轮有 400 风险。
const LlmThinkingBlockSchema: z.ZodType<LlmThinkingBlock> = z.union([
  z.object({
    type: z.literal("thinking"),
    thinking: z.string(),
    signature: z.string(),
  }),
  z.object({
    type: z.literal("redacted_thinking"),
    data: z.string(),
  }),
]);

const LlmMessageSchema: z.ZodType<LlmMessage> = z.union([
  z.object({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(LlmContentPartSchema)]),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string(),
    toolCalls: z.array(LlmToolCallSchema),
    thinkingBlocks: z.array(LlmThinkingBlockSchema).optional(),
  }),
  z.object({
    role: z.literal("tool"),
    toolCallId: z.string().min(1),
    content: z.string(),
  }),
]);

const PersistedAgentContextSnapshotSchema = z.object({
  messages: z.array(LlmMessageSchema),
});

export type PersistedAgentContextSnapshot = z.infer<typeof PersistedAgentContextSnapshotSchema>;

export const PersistedRootAgentRuntimeSnapshotSchema = z.object({
  runtimeKey: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  contextSnapshot: PersistedAgentContextSnapshotSchema,
  lastWakeReminderAt: DateValueSchema.nullable(),
});

export type PersistedRootAgentRuntimeSnapshot = z.infer<
  typeof PersistedRootAgentRuntimeSnapshotSchema
>;
