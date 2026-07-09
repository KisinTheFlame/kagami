import { defineJsonRoute } from "@kagami/http/contract";
import { LlmProviderListResponseSchema } from "./llm-chat.js";
import { z } from "zod";

// === kagami-llm 面向管理台的 provider 列举契约 ===
//
// 与 contract.ts 的内部 RPC（agent→llm，`/internal/*`）分成两图：这条的消费者是 web 管理台
// （「LLM 调用历史」按 provider 过滤），经 gateway `/llm/providers` 前缀分流到 kagami-llm，前端用
// createClient 直连、不再经 agent 中转（镜像 scheduler #493 的 view 契约范式）。故不复用 `/internal`
// 前缀——那是「对 agent 的内部 RPC」定位，不该经网关开给浏览器。
//
// input 保持空：「以 agent 视角列举可用 provider」这个语义收在服务侧 handler（固定 usage:"agent"），
// 前端无需知道 usage。output 复用 llm-chat 的 `{ providers }` 形状（与迁移前 agent 端点逐字一致）。
export const llmProvidersViewContract = {
  listProviders: defineJsonRoute({
    method: "GET",
    path: "/llm/providers",
    input: z.object({}),
    output: LlmProviderListResponseSchema,
  }),
} as const;
