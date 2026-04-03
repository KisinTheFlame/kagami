import { z } from "zod";
import type {
  LlmContentPart,
  LlmImageContentPart,
  LlmMessage,
  LlmTextContentPart,
  LlmToolCall,
} from "../../../../llm/types.js";
import type {
  NapcatFriendInfo,
  NapcatGetGroupInfoResult,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";
import { NapcatReceiveMessageSegmentSchema } from "../../../../napcat/schema/napcat-segment.js";

const DateValueSchema = z.coerce.date();
const JsonRecordSchema = z.record(z.string(), z.unknown());
const BufferSchema = z.custom<Buffer>(() => true);

const LlmTextContentPartSchema: z.ZodType<LlmTextContentPart> = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const LlmImageContentPartSchema: z.ZodType<LlmImageContentPart> = z.object({
  type: z.literal("image"),
  content: BufferSchema,
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

const NapcatGetGroupInfoResultSchema: z.ZodType<NapcatGetGroupInfoResult> = z.object({
  groupId: z.string().min(1),
  groupName: z.string(),
  memberCount: z.number().int().nonnegative(),
  maxMemberCount: z.number().int().nonnegative(),
  groupRemark: z.string(),
  groupAllShut: z.boolean(),
});

const NapcatFriendInfoSchema: z.ZodType<NapcatFriendInfo> = z.object({
  userId: z.string().min(1),
  nickname: z.string(),
  remark: z.string().nullable(),
});

const NapcatGroupMessageDataSchema: z.ZodType<NapcatGroupMessageData> = z.object({
  groupId: z.string().min(1),
  userId: z.string().min(1),
  nickname: z.string(),
  rawMessage: z.string(),
  messageSegments: z.array(NapcatReceiveMessageSegmentSchema),
  messageId: z.number().int().nullable(),
  time: z.number().int().nullable(),
});

const NapcatPrivateMessageDataSchema: z.ZodType<NapcatPrivateMessageData> = z.object({
  userId: z.string().min(1),
  nickname: z.string(),
  remark: z.string().nullable(),
  rawMessage: z.string(),
  messageSegments: z.array(NapcatReceiveMessageSegmentSchema),
  messageId: z.number().int().nullable(),
  time: z.number().int().nullable(),
});

export const PersistedAgentContextSnapshotSchema = z.object({
  messages: z.array(LlmMessageSchema),
});

export type PersistedAgentContextSnapshot = z.infer<typeof PersistedAgentContextSnapshotSchema>;

const PersistedRootAgentSessionGroupStateSchema = z.object({
  groupId: z.string().min(1),
  groupInfo: NapcatGetGroupInfoResultSchema.nullable(),
  unreadMessages: z.array(NapcatGroupMessageDataSchema),
  hasEntered: z.boolean(),
});

export type PersistedRootAgentSessionGroupState = z.infer<
  typeof PersistedRootAgentSessionGroupStateSchema
>;

const PersistedRootAgentSessionPrivateChatStateSchema = z.object({
  userId: z.string().min(1),
  friendInfo: NapcatFriendInfoSchema.nullable(),
  unreadMessages: z.array(NapcatPrivateMessageDataSchema),
  hasEntered: z.boolean(),
});

export type PersistedRootAgentSessionPrivateChatState = z.infer<
  typeof PersistedRootAgentSessionPrivateChatStateSchema
>;

const PersistedRootAgentIthomeFeedStateSchema = z.object({
  kind: z.literal("ithome"),
  label: z.string().min(1),
  unreadCount: z.number().int().nonnegative(),
  hasEntered: z.boolean(),
});

export type PersistedRootAgentIthomeFeedState = z.infer<
  typeof PersistedRootAgentIthomeFeedStateSchema
>;

const PersistedRootAgentWaitOverlaySchema = z.object({
  deadlineAt: DateValueSchema,
  resumeStateStack: z.array(z.string().min(1)).min(1),
});

export type PersistedRootAgentWaitOverlay = z.infer<typeof PersistedRootAgentWaitOverlaySchema>;

export const PersistedRootAgentSessionSnapshotSchema = z.object({
  stateStack: z.array(z.string().min(1)).min(1),
  waitOverlay: PersistedRootAgentWaitOverlaySchema.nullable(),
  groups: z.array(PersistedRootAgentSessionGroupStateSchema),
  privateChats: z.array(PersistedRootAgentSessionPrivateChatStateSchema).default([]),
  ithomeFeedState: PersistedRootAgentIthomeFeedStateSchema.nullable(),
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
