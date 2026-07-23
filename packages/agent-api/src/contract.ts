import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";
import {
  MainAgentContextCompactionResultSchema,
  MainAgentContextSnapshotSchema,
} from "./main-agent-context.js";
import {
  AgentQueryAppLogsRequestSchema,
  AgentQueryAppLogsResponseSchema,
  AgentQueryInnerThoughtsRequestSchema,
  AgentQueryInnerThoughtsResponseSchema,
  AgentQueryTodosRequestSchema,
  AgentQueryTodosResponseSchema,
} from "./ops-query.js";

// === @kagami/agent-api：kagami-agent 服务面向管理台的 HTTP 契约（issue #279 PR5） ===
//
// 消费者是 web 前端（gateway 默认目标）。web 走 contractUrl 取 path/schema，fetch 层与
// ApiError 链路不变（D1）。agent 对上游（llm/oss/browser/spire/metric）的消费契约在各上游
// 自己的 *-api 包，这里只收 agent 自己产出的路由。

export const agentApiContract = {
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
  // —— console 只读查询（epic #539 子 issue 4：console 脱库，agent 持有的三张表经此查询）——
  //    主消费者是 kagami-console 服务间直连；注意 gateway 的 /api/* 兜底也反代到 agent，
  //    故这些路由与本契约其余管理台路由同鉴权面（前门可达），不得按「仅内网可达」的假设放宽校验。
  queryAppLogs: defineJsonRoute({
    method: "POST",
    path: "/ops/app-logs/query",
    input: AgentQueryAppLogsRequestSchema,
    output: AgentQueryAppLogsResponseSchema,
  }),
  queryInnerThoughts: defineJsonRoute({
    method: "POST",
    path: "/ops/inner-thoughts/query",
    input: AgentQueryInnerThoughtsRequestSchema,
    output: AgentQueryInnerThoughtsResponseSchema,
  }),
  queryTodos: defineJsonRoute({
    method: "POST",
    path: "/ops/todos/query",
    input: AgentQueryTodosRequestSchema,
    output: AgentQueryTodosResponseSchema,
  }),
} as const;
