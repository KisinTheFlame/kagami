import { z } from "zod";
import type {
  LlmContentPart,
  LlmImageContentPart,
  LlmMessage,
  LlmTextContentPart,
  LlmToolCall,
} from "../../../../llm/types.js";

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

const LlmMessageSchema: z.ZodType<LlmMessage> = z.union([
  z.object({
    role: z.literal("user"),
    content: z.union([z.string(), z.array(LlmContentPartSchema)]),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string(),
    toolCalls: z.array(LlmToolCallSchema),
  }),
  z.object({
    role: z.literal("tool"),
    toolCallId: z.string().min(1),
    content: z.string(),
  }),
]);

export const PersistedAgentContextSnapshotSchema = z.object({
  messages: z.array(LlmMessageSchema),
});

export type PersistedAgentContextSnapshot = z.infer<typeof PersistedAgentContextSnapshotSchema>;

export const PersistedRootAgentSessionSnapshotSchema = z.object({
  // 手机 OS 模型下 session 退化为 App 启动器，不再持聊天状态。stateStack 恒为
  // ["portal"]。状态树时代的 legacy 字段（waitOverlay / groups / privateChats /
  // ithomeFeedState）已不再声明：会话状态归 QqApp，旧快照里若仍带这些键，非 strict
  // 对象解析会自动 strip，反序列化照常成功。
  stateStack: z.array(z.string().min(1)).min(1).default(["portal"]),
});

export type PersistedRootAgentSessionSnapshot = z.infer<
  typeof PersistedRootAgentSessionSnapshotSchema
>;
export type CurrentPersistedRootAgentSessionSnapshot = PersistedRootAgentSessionSnapshot;

export const PersistedRootAgentRuntimeSnapshotSchema = z.object({
  runtimeKey: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  contextSnapshot: PersistedAgentContextSnapshotSchema,
  sessionSnapshot: PersistedRootAgentSessionSnapshotSchema,
  lastWakeReminderAt: DateValueSchema.nullable(),
});

export type PersistedRootAgentRuntimeSnapshot = z.infer<
  typeof PersistedRootAgentRuntimeSnapshotSchema
>;
