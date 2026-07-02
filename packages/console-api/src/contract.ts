import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";
import { AppLogListQuerySchema, AppLogListResponseSchema } from "./app-log.js";
import {
  LlmChatCallDetailResponseSchema,
  LlmChatCallListQuerySchema,
  LlmChatCallListResponseSchema,
} from "./llm-chat-call.js";
import { NapcatEventListQuerySchema, NapcatEventListResponseSchema } from "./napcat-event.js";
import {
  NapcatQqMessageListQuerySchema,
  NapcatQqMessageListResponseSchema,
} from "./napcat-group-message.js";

// === @kagami/console-api：kagami-console 服务的 HTTP 契约（issue #279 PR4） ===
//
// console 是纯 DB 查询后端（管理台历史检索），消费者是 web 前端（经 gateway 按前缀分流）。
// web 走 contractUrl 取 path/schema，fetch 层与 ApiError 链路不变（D1）。

export const consoleApiContract = {
  queryAppLogs: defineJsonRoute({
    method: "GET",
    path: "/app-log/query",
    input: AppLogListQuerySchema,
    output: AppLogListResponseSchema,
  }),
  queryLlmChatCalls: defineJsonRoute({
    method: "GET",
    path: "/llm-chat-call/query",
    input: LlmChatCallListQuerySchema,
    output: LlmChatCallListResponseSchema,
  }),
  getLlmChatCallDetail: defineJsonRoute({
    method: "GET",
    path: "/llm-chat-call/:id",
    params: z.object({
      id: z.preprocess(
        value => (typeof value === "string" ? Number.parseInt(value, 10) : value),
        z.number().int().positive(),
      ),
    }),
    input: z.object({}),
    output: LlmChatCallDetailResponseSchema,
  }),
  queryNapcatEvents: defineJsonRoute({
    method: "GET",
    path: "/napcat-event/query",
    input: NapcatEventListQuerySchema,
    output: NapcatEventListResponseSchema,
  }),
  queryNapcatQqMessages: defineJsonRoute({
    method: "GET",
    path: "/napcat-group-message/query",
    input: NapcatQqMessageListQuerySchema,
    output: NapcatQqMessageListResponseSchema,
  }),
} as const;
