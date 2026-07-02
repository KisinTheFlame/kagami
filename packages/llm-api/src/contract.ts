import { defineJsonRoute } from "@kagami/http/contract";
import { LlmProviderOptionSchema } from "@kagami/shared/schemas/llm-chat";
import { z } from "zod";

/**
 * kagami-llm 进程对 agent 暴露的内部 RPC 契约（单一事实源）。服务端 handler 与 agent 侧 client
 * 都从这里派生类型 —— 改 output，两端一起编译报错（issue #230）。
 *
 * 现阶段只覆盖 `/internal/providers`（最干净的 JSON 往返，作样板证明编译期强制）。chat / chat-direct /
 * embed 的响应是刻意不逐字段校验的复杂 union（服务端 z.unknown），留作后续「信封级」迁移，不在此契约内。
 */
export const llmApiContract = {
  listProviders: defineJsonRoute({
    method: "GET",
    path: "/internal/providers",
    input: z.object({ usage: z.string().min(1) }),
    output: z.array(LlmProviderOptionSchema),
    // providers 是轻查询：服务真挂/半开的兜底超时，非每次调用时限。
    timeoutMs: 30_000,
  }),
};
