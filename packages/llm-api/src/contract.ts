import { defineJsonRoute } from "@kagami/http/contract";
import { LlmProviderOptionSchema } from "./llm-chat.js";
import { z } from "zod";

// chat / chat-direct 的客户端超时是「服务真挂/半开」的兜底，不是每次 chat 的时限：服务端每个
// provider attempt 有自己的 timeout、可能多 attempt 串行，总耗时可达 attempts × timeoutMs。给一个
// 远高于任何现实多-attempt 总时长的上限（10 分钟），确保服务端 provider 超时永远先触发、回出规整
// BizError，避免 client 先 abort 却让服务端 in-flight 上游请求继续跑（重复调用 + 成本放大）。
const CHAT_TIMEOUT_MS = 600_000;
const QUERY_TIMEOUT_MS = 30_000;
const EMBED_TIMEOUT_MS = 60_000;
// 生图是多秒级操作（模型思考 + 渲染），给 5 分钟兜底超时，远高于现实单次生图时长。
const GENERATE_IMAGE_TIMEOUT_MS = 300_000;

/**
 * chat / chat-direct / embed 的 `request` 是复杂 union（LlmMessage / Tool / EmbeddingRequest），刻意
 * 用 `z.unknown()` 只校验信封外壳、不逐字段 zod —— 这是既有设计（见 internal-llm.handler 注释），非
 * 技术债。output 同理留 `z.unknown()`：**信封级**，服务端返回结构不进 Zod，消费端门面按类型断言。
 * 这三条路由的价值是统一 HTTP 管线 + 错误通道 + 超时，而非给复杂 union 加编译期字段校验（那属
 * listProviders 这类真 JSON schema 的路由）。
 */
const EnvelopeRequest = z.unknown();

/**
 * kagami-llm 进程对 agent 暴露的内部 RPC 契约（单一事实源）。服务端 handler 与 agent 侧 client
 * 都从这里派生类型 —— 改 output，两端一起编译报错（issue #230）。
 *
 * - `listProviders`：真 JSON schema，output 全类型化，是编译期强制的样板。
 * - `chat` / `chatDirect` / `embed`：信封级（output `z.unknown()`），复杂 union 不逐字段校验，见上。
 */
export const llmApiContract = {
  listProviders: defineJsonRoute({
    method: "GET",
    path: "/internal/providers",
    input: z.object({ usage: z.string().min(1) }),
    output: z.array(LlmProviderOptionSchema),
    // providers 是轻查询：服务真挂/半开的兜底超时，非每次调用时限。
    timeoutMs: QUERY_TIMEOUT_MS,
  }),
  chat: defineJsonRoute({
    method: "POST",
    path: "/internal/chat",
    input: z.object({
      request: EnvelopeRequest,
      usage: z.string().min(1),
      recordCall: z.boolean().optional(),
    }),
    output: z.unknown(),
    timeoutMs: CHAT_TIMEOUT_MS,
  }),
  chatDirect: defineJsonRoute({
    method: "POST",
    path: "/internal/chat-direct",
    input: z.object({
      request: EnvelopeRequest,
      providerId: z.string().min(1),
      model: z.string().min(1),
      recordCall: z.boolean().optional(),
    }),
    output: z.unknown(),
    timeoutMs: CHAT_TIMEOUT_MS,
  }),
  embed: defineJsonRoute({
    method: "POST",
    path: "/internal/embed",
    input: z.object({ request: EnvelopeRequest }),
    output: z.unknown(),
    timeoutMs: EMBED_TIMEOUT_MS,
  }),
  // request 是 ImageGenerationRequest（信封级 z.unknown()，同 chat/embed）；output 是 base64 化的
  // GenerateImageResult（见 llm-api/image），亦走信封级、消费端按类型断言。
  generateImage: defineJsonRoute({
    method: "POST",
    path: "/internal/generate-image",
    input: z.object({ request: EnvelopeRequest }),
    output: z.unknown(),
    timeoutMs: GENERATE_IMAGE_TIMEOUT_MS,
  }),
};
