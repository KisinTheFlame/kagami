import { z } from "zod";
import { JsonRecordSchema } from "@kagami/http/wire";
import { MessageSegmentsSchema } from "./segment.js";

/**
 * napcat 服务对 agent 暴露的 RPC 数据形状（wire）—— 忠实镜像原 `NapcatGatewayService` 接口
 * （issue #347 拆分）。出站发送、消息历史、群文件、群信息、合并转发的入参 / 出参都收在这里。
 *
 * 出站发送的 wire 入参只有一个纯文本 `message` 字符串 + 可选 `replyToMessageId`：reply / at /
 * image 段的拼装是 napcat 网关内部实现细节，不进契约。
 */

// —— 聊天目标 ——
// discriminatedUnion + strict：group / private 二选一，矛盾字段（如 group 里带 userId）在 wire
// 边界即报错而非被静默 strip，避免掩盖调用方的目标字段错配。
export const NapcatChatTargetSchema = z.discriminatedUnion("chatType", [
  z.object({ chatType: z.literal("group"), groupId: z.string().min(1) }).strict(),
  z.object({ chatType: z.literal("private"), userId: z.string().min(1) }).strict(),
]);
export type NapcatChatTarget = z.infer<typeof NapcatChatTargetSchema>;

// —— 出站：群 / 私聊发文本 ——
// `replyToMessageId` 是 wire 上的可选字段：agent 侧发送可引用回复，web / 管理台直发不带即普通发送。
// `.strict()` 拒绝未知键（沿用原 agent-api send schema 的严格语义），畸形入参在边界即 400。
export const NapcatSendGroupMessageRequestSchema = z
  .object({
    groupId: z.string().min(1),
    message: z.string().min(1),
    replyToMessageId: z.number().int().positive().optional(),
  })
  .strict();
export type NapcatSendGroupMessageRequest = z.infer<typeof NapcatSendGroupMessageRequestSchema>;

export const NapcatSendPrivateMessageRequestSchema = z
  .object({
    userId: z.string().min(1),
    message: z.string().min(1),
    replyToMessageId: z.number().int().positive().optional(),
  })
  .strict();
export type NapcatSendPrivateMessageRequest = z.infer<typeof NapcatSendPrivateMessageRequestSchema>;

export const NapcatSendMessageResponseSchema = z.object({
  messageId: z.number().int().positive(),
});
export type NapcatSendMessageResponse = z.infer<typeof NapcatSendMessageResponseSchema>;

// —— 出站：发图 ——
// `fileRef` 是 OneBot file 字段（send_resource 用 base64:// 形态，自包含）。**不要记录 fileRef**。
export const NapcatSendImageRequestSchema = z
  .object({
    target: NapcatChatTargetSchema,
    fileRef: z.string().min(1),
    summary: z.string().optional(),
    replyToMessageId: z.number().int().positive().optional(),
  })
  .strict();
export type NapcatSendImageRequest = z.infer<typeof NapcatSendImageRequestSchema>;

// —— 好友列表 ——
export const NapcatFriendInfoSchema = z.object({
  userId: z.string(),
  nickname: z.string(),
  remark: z.string().nullable(),
});
export type NapcatFriendInfo = z.infer<typeof NapcatFriendInfoSchema>;

export const NapcatFriendListResponseSchema = z.object({
  friends: z.array(NapcatFriendInfoSchema),
});
export type NapcatFriendListResponse = z.infer<typeof NapcatFriendListResponseSchema>;

// —— 群信息 ——
export const NapcatGetGroupInfoRequestSchema = z.object({
  groupId: z.string().min(1),
});
export type NapcatGetGroupInfoRequest = z.infer<typeof NapcatGetGroupInfoRequestSchema>;

export const NapcatGetGroupInfoResponseSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  memberCount: z.number(),
  maxMemberCount: z.number(),
  groupRemark: z.string(),
  groupAllShut: z.boolean(),
});
export type NapcatGetGroupInfoResponse = z.infer<typeof NapcatGetGroupInfoResponseSchema>;

// —— 群消息数据（getRecentGroupMessages 出参 + 群消息事件 data）——
export const NapcatGroupMessageDataSchema = z.object({
  groupId: z.string(),
  userId: z.string(),
  nickname: z.string(),
  rawMessage: z.string(),
  messageSegments: MessageSegmentsSchema,
  messageId: z.number().nullable(),
  time: z.number().nullable(),
});
export type NapcatGroupMessageData = z.infer<typeof NapcatGroupMessageDataSchema>;

// —— 私聊消息数据（私聊消息事件 data）——
export const NapcatPrivateMessageDataSchema = z.object({
  userId: z.string(),
  nickname: z.string(),
  remark: z.string().nullable(),
  rawMessage: z.string(),
  messageSegments: MessageSegmentsSchema,
  messageId: z.number().nullable(),
  time: z.number().nullable(),
});
export type NapcatPrivateMessageData = z.infer<typeof NapcatPrivateMessageDataSchema>;

// —— 可持久化 QQ 消息（getRecentPrivateMessages 出参）——
export const NapcatPersistableQqMessageSchema = z.object({
  messageType: z.enum(["group", "private"]),
  subType: z.string(),
  groupId: z.string().nullable(),
  userId: z.string().nullable(),
  nickname: z.string().nullable(),
  rawMessage: z.string(),
  messageSegments: MessageSegmentsSchema,
  messageId: z.number().nullable(),
  time: z.number().nullable(),
  payload: JsonRecordSchema,
});
export type NapcatPersistableQqMessage = z.infer<typeof NapcatPersistableQqMessageSchema>;

export const NapcatGetRecentGroupMessagesRequestSchema = z.object({
  groupId: z.string().min(1),
  count: z.number().int().positive(),
});
export type NapcatGetRecentGroupMessagesRequest = z.infer<
  typeof NapcatGetRecentGroupMessagesRequestSchema
>;

export const NapcatGetRecentGroupMessagesResponseSchema = z.object({
  messages: z.array(NapcatGroupMessageDataSchema),
});
export type NapcatGetRecentGroupMessagesResponse = z.infer<
  typeof NapcatGetRecentGroupMessagesResponseSchema
>;

export const NapcatGetRecentPrivateMessagesRequestSchema = z.object({
  userId: z.string().min(1),
  count: z.number().int().positive(),
  messageSeq: z.number().int().optional(),
});
export type NapcatGetRecentPrivateMessagesRequest = z.infer<
  typeof NapcatGetRecentPrivateMessagesRequestSchema
>;

export const NapcatGetRecentPrivateMessagesResponseSchema = z.object({
  messages: z.array(NapcatPersistableQqMessageSchema),
});
export type NapcatGetRecentPrivateMessagesResponse = z.infer<
  typeof NapcatGetRecentPrivateMessagesResponseSchema
>;

// —— 合并转发 ——
export const NapcatForwardMessageNodeSchema = z.object({
  senderName: z.string(),
  senderUserId: z.string().nullable(),
  rawMessage: z.string(),
  time: z.number().nullable(),
});
export type NapcatForwardMessageNode = z.infer<typeof NapcatForwardMessageNodeSchema>;

export const NapcatGetForwardMessagesRequestSchema = z.object({
  id: z.string().min(1),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type NapcatGetForwardMessagesRequest = z.infer<typeof NapcatGetForwardMessagesRequestSchema>;

export const NapcatForwardMessagePageSchema = z.object({
  nodes: z.array(NapcatForwardMessageNodeSchema),
  total: z.number(),
  offset: z.number(),
});
export type NapcatForwardMessagePage = z.infer<typeof NapcatForwardMessagePageSchema>;

// —— 群文件 ——
export const NapcatGroupFileEntrySchema = z.object({
  fileId: z.string(),
  fileName: z.string(),
  size: z.number(),
  uploadTime: z.number().nullable(),
  uploaderName: z.string(),
});
export type NapcatGroupFileEntry = z.infer<typeof NapcatGroupFileEntrySchema>;

export const NapcatGroupFolderEntrySchema = z.object({
  folderId: z.string(),
  folderName: z.string(),
  fileCount: z.number(),
});
export type NapcatGroupFolderEntry = z.infer<typeof NapcatGroupFolderEntrySchema>;

export const NapcatListGroupFilesRequestSchema = z.object({
  groupId: z.string().min(1),
  folderId: z.string().optional(),
  fileCount: z.number().int().positive().optional(),
});
export type NapcatListGroupFilesRequest = z.infer<typeof NapcatListGroupFilesRequestSchema>;

export const NapcatGroupFileListingSchema = z.object({
  files: z.array(NapcatGroupFileEntrySchema),
  folders: z.array(NapcatGroupFolderEntrySchema),
});
export type NapcatGroupFileListing = z.infer<typeof NapcatGroupFileListingSchema>;

export const NapcatGetGroupFileUrlRequestSchema = z.object({
  groupId: z.string().min(1),
  fileId: z.string().min(1),
});
export type NapcatGetGroupFileUrlRequest = z.infer<typeof NapcatGetGroupFileUrlRequestSchema>;

export const NapcatGetGroupFileUrlResponseSchema = z.object({
  url: z.string(),
});
export type NapcatGetGroupFileUrlResponse = z.infer<typeof NapcatGetGroupFileUrlResponseSchema>;

export const NapcatUploadGroupFileRequestSchema = z.object({
  groupId: z.string().min(1),
  fileRef: z.string().min(1),
  name: z.string().min(1),
  folderId: z.string().optional(),
});
export type NapcatUploadGroupFileRequest = z.infer<typeof NapcatUploadGroupFileRequestSchema>;

// —— 群成员禁言到期时间戳 ——
// 未被禁言（0 / 过去 / 缺失 / 畸形）为 null。scalar 包一层对象，保持 JSON 出参恒为对象。
export const NapcatGetGroupMemberShutUpRequestSchema = z.object({
  groupId: z.string().min(1),
  userId: z.string().min(1),
});
export type NapcatGetGroupMemberShutUpRequest = z.infer<
  typeof NapcatGetGroupMemberShutUpRequestSchema
>;

// `shutUpUntilMs`：禁言到期的**毫秒**时间戳（原实现已把 NapCat 秒级 shut_up_timestamp 换算成
// 毫秒）。字段名带单位，避免消费者误当成 NapCat 原始秒级值。
export const NapcatGetGroupMemberShutUpResponseSchema = z.object({
  shutUpUntilMs: z.number().nullable(),
});
export type NapcatGetGroupMemberShutUpResponse = z.infer<
  typeof NapcatGetGroupMemberShutUpResponseSchema
>;

/** void 返回的路由（uploadGroupFile）统一回空对象信封。 */
export const NapcatEmptyResponseSchema = z.object({});
export type NapcatEmptyResponse = z.infer<typeof NapcatEmptyResponseSchema>;
