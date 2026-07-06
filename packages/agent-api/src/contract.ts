import { defineJsonRoute } from "@kagami/http/contract";
import { LlmProviderListResponseSchema } from "@kagami/llm-api/llm-chat";
import { z } from "zod";
import {
  MainAgentContextCompactionResultSchema,
  MainAgentContextSnapshotSchema,
} from "./main-agent-context.js";
import {
  NapcatSendGroupMessageRequestSchema,
  NapcatSendGroupMessageResponseSchema,
  NapcatSendPrivateMessageRequestSchema,
  NapcatSendPrivateMessageResponseSchema,
} from "./napcat-message.js";
import {
  SchedulerTaskListResponseSchema,
  SchedulerTriggerParamsSchema,
  SchedulerTriggerResponseSchema,
} from "./scheduler.js";

// === @kagami/agent-api：kagami-agent 服务面向管理台的 HTTP 契约（issue #279 PR5） ===
//
// 消费者是 web 前端（gateway 默认目标）。web 走 contractUrl 取 path/schema，fetch 层与
// ApiError 链路不变（D1）。agent 对上游（llm/oss/browser/spire/metric）的消费契约在各上游
// 自己的 *-api 包，这里只收 agent 自己产出的路由。

export const agentApiContract = {
  sendGroupMessage: defineJsonRoute({
    method: "POST",
    path: "/napcat/group/send",
    input: NapcatSendGroupMessageRequestSchema,
    output: NapcatSendGroupMessageResponseSchema,
  }),
  sendPrivateMessage: defineJsonRoute({
    method: "POST",
    path: "/napcat/private/send",
    input: NapcatSendPrivateMessageRequestSchema,
    output: NapcatSendPrivateMessageResponseSchema,
  }),
  listProviders: defineJsonRoute({
    method: "GET",
    path: "/llm/providers",
    input: z.object({}),
    output: LlmProviderListResponseSchema,
  }),
  listSchedulerTasks: defineJsonRoute({
    method: "GET",
    path: "/scheduler/tasks",
    input: z.object({}),
    output: SchedulerTaskListResponseSchema,
  }),
  triggerSchedulerTask: defineJsonRoute({
    method: "POST",
    path: "/scheduler/tasks/:name/trigger",
    params: SchedulerTriggerParamsSchema,
    input: z.object({}),
    output: SchedulerTriggerResponseSchema,
  }),
  getRecentMainAgentContext: defineJsonRoute({
    method: "GET",
    path: "/main-agent-context/recent",
    // strict：多余 query 按 400 拒收（沿袭旧 registerQueryRoute 行为）。
    input: z.object({}).strict(),
    output: MainAgentContextSnapshotSchema,
  }),
  compactMainAgentContext: defineJsonRoute({
    method: "POST",
    path: "/main-agent-context/compact",
    input: z.object({}).strict(),
    output: MainAgentContextCompactionResultSchema,
  }),
} as const;
