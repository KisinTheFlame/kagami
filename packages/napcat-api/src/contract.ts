import { defineJsonRoute } from "@kagami/http/contract";
import {
  NapcatEmptyResponseSchema,
  NapcatFriendListResponseSchema,
  NapcatGetForwardMessagesRequestSchema,
  NapcatForwardMessagePageSchema,
  NapcatGetGroupFileUrlRequestSchema,
  NapcatGetGroupFileUrlResponseSchema,
  NapcatGetGroupInfoRequestSchema,
  NapcatGetGroupInfoResponseSchema,
  NapcatGetGroupMemberShutUpRequestSchema,
  NapcatGetGroupMemberShutUpResponseSchema,
  NapcatGetRecentGroupMessagesRequestSchema,
  NapcatGetRecentGroupMessagesResponseSchema,
  NapcatGetRecentPrivateMessagesRequestSchema,
  NapcatGetRecentPrivateMessagesResponseSchema,
  NapcatGroupFileListingSchema,
  NapcatListGroupFilesRequestSchema,
  NapcatSendGroupMessageRequestSchema,
  NapcatSendImageRequestSchema,
  NapcatSendMessageResponseSchema,
  NapcatSendPrivateMessageRequestSchema,
  NapcatUploadGroupFileRequestSchema,
} from "./message.js";
import {
  NapcatEventListQuerySchema,
  NapcatEventListResponseSchema,
  NapcatQqMessageListQuerySchema,
  NapcatQqMessageListResponseSchema,
} from "./query.js";
import { z } from "zod";

/**
 * kagami-napcat 进程的对外契约（单一事实源，issue #347 / 沿用 #230 方向）。三组消费者：
 *
 * - **agent**（出站 RPC + 入站 SSE）：13 个网关方法逐一成 JSON 路由；入站事件走 SSE，不在此
 *   JSON 契约里建模（见 event.ts 的 `NAPCAT_EVENTS_SSE_PATH` / `NapcatOutboxEventSchema`）。
 * - **web / 管理台直发（B）**：复用 `sendGroupMessage` / `sendPrivateMessage` 两条 send 路由
 *   （gateway 反代 `/api/napcat/*`）；被禁言时服务端回 `{ reason: "GROUP_MUTED" }` 的 403 富错误。
 * - **console 只读查询（A2）**：`queryNapcatEvents` / `queryNapcatQqMessages`，schema 与旧
 *   console-api 一致，让 #350 console 从直读 DAO 切成 HTTP client 为 drop-in。
 *
 * 出站发送的 wire 入参只有纯文本 `message` + 可选 `replyToMessageId`；段拼装归网关内部。读类
 * RPC 一律用 POST（JSON body），避免 GET query 的数字/嵌套强转。
 *
 * KV 缓存字节契约（#173）：agent 侧工具从这些 output 的具名字段重新 stringify 出 tool_result，
 * output 字段不变 ⇒ tool_result 字节不变。改 output 会让服务端 handler 与 agent 门面同时编译报错。
 */
export const napcatApiContract = {
  // —— 出站发送（agent + web 直发共用）——
  sendGroupMessage: defineJsonRoute({
    method: "POST",
    path: "/napcat/group/send",
    input: NapcatSendGroupMessageRequestSchema,
    output: NapcatSendMessageResponseSchema,
  }),
  sendPrivateMessage: defineJsonRoute({
    method: "POST",
    path: "/napcat/private/send",
    input: NapcatSendPrivateMessageRequestSchema,
    output: NapcatSendMessageResponseSchema,
  }),
  sendImage: defineJsonRoute({
    method: "POST",
    path: "/napcat/image/send",
    input: NapcatSendImageRequestSchema,
    output: NapcatSendMessageResponseSchema,
  }),

  // —— 只读 RPC（agent 拉历史 / 群信息 / 转发 / 文件）——
  getFriendList: defineJsonRoute({
    method: "POST",
    path: "/napcat/friends/list",
    input: z.object({}),
    output: NapcatFriendListResponseSchema,
  }),
  getGroupInfo: defineJsonRoute({
    method: "POST",
    path: "/napcat/group/info",
    input: NapcatGetGroupInfoRequestSchema,
    output: NapcatGetGroupInfoResponseSchema,
  }),
  getRecentGroupMessages: defineJsonRoute({
    method: "POST",
    path: "/napcat/group/recent-messages",
    input: NapcatGetRecentGroupMessagesRequestSchema,
    output: NapcatGetRecentGroupMessagesResponseSchema,
  }),
  getRecentPrivateMessages: defineJsonRoute({
    method: "POST",
    path: "/napcat/private/recent-messages",
    input: NapcatGetRecentPrivateMessagesRequestSchema,
    output: NapcatGetRecentPrivateMessagesResponseSchema,
  }),
  getForwardMessages: defineJsonRoute({
    method: "POST",
    path: "/napcat/forward/get",
    input: NapcatGetForwardMessagesRequestSchema,
    output: NapcatForwardMessagePageSchema,
  }),
  listGroupFiles: defineJsonRoute({
    method: "POST",
    path: "/napcat/group/files/list",
    input: NapcatListGroupFilesRequestSchema,
    output: NapcatGroupFileListingSchema,
  }),
  getGroupFileUrl: defineJsonRoute({
    method: "POST",
    path: "/napcat/group/files/url",
    input: NapcatGetGroupFileUrlRequestSchema,
    output: NapcatGetGroupFileUrlResponseSchema,
  }),
  getGroupMemberShutUp: defineJsonRoute({
    method: "POST",
    path: "/napcat/group/member-shut-up",
    input: NapcatGetGroupMemberShutUpRequestSchema,
    output: NapcatGetGroupMemberShutUpResponseSchema,
  }),
  uploadGroupFile: defineJsonRoute({
    method: "POST",
    path: "/napcat/group/files/upload",
    input: NapcatUploadGroupFileRequestSchema,
    output: NapcatEmptyResponseSchema,
  }),

  // —— console 只读查询（A2）——
  queryNapcatEvents: defineJsonRoute({
    method: "GET",
    path: "/napcat/events/query",
    input: NapcatEventListQuerySchema,
    output: NapcatEventListResponseSchema,
  }),
  queryNapcatQqMessages: defineJsonRoute({
    method: "GET",
    path: "/napcat/qq-messages/query",
    input: NapcatQqMessageListQuerySchema,
    output: NapcatQqMessageListResponseSchema,
  }),
} as const;
