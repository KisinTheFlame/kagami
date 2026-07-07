import { defineJsonRoute } from "@kagami/http/contract";
import { z } from "zod";
import {
  AuthLoginUrlResponseSchema,
  AuthLogoutResponseSchema,
  AuthProviderSchema,
  AuthRefreshResponseSchema,
  AuthStatusResponseSchema,
  AuthUsageLimitsResponseSchema,
} from "./auth.js";

// === OAuth 凭据管理路由契约（#279 PR6） ===
//
// 认证管理端点随 LLM 服务外移（gateway 把 /auth 前缀分流到 kagami-llm），handler 实现在
// @kagami/auth，故契约归 llm-api。与 contract.ts 的内部 RPC（agent→llm）分开成图：消费者
// 是 web 管理台（contractUrl 取 path/schema，D1），不进 createClient。
// 五条路由共用 :provider 路径参数（PR1 params 通道）。

const AuthProviderParamsSchema = z
  .object({
    provider: AuthProviderSchema,
  })
  .strict();

const EmptyStrictSchema = z.object({}).strict();

export const authApiContract = {
  getAuthStatus: defineJsonRoute({
    method: "GET",
    path: "/auth/:provider/status",
    params: AuthProviderParamsSchema,
    input: EmptyStrictSchema,
    output: AuthStatusResponseSchema,
  }),
  createAuthLoginUrl: defineJsonRoute({
    method: "POST",
    path: "/auth/:provider/login-url",
    params: AuthProviderParamsSchema,
    input: EmptyStrictSchema,
    output: AuthLoginUrlResponseSchema,
  }),
  authLogout: defineJsonRoute({
    method: "POST",
    path: "/auth/:provider/logout",
    params: AuthProviderParamsSchema,
    input: EmptyStrictSchema,
    output: AuthLogoutResponseSchema,
  }),
  authRefresh: defineJsonRoute({
    method: "POST",
    path: "/auth/:provider/refresh",
    params: AuthProviderParamsSchema,
    input: EmptyStrictSchema,
    output: AuthRefreshResponseSchema,
  }),
  getAuthUsageLimits: defineJsonRoute({
    method: "GET",
    path: "/auth/:provider/usage-limits",
    params: AuthProviderParamsSchema,
    input: EmptyStrictSchema,
    output: AuthUsageLimitsResponseSchema,
  }),
} as const;
