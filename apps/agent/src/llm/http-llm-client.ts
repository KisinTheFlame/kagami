import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { llmApiContract } from "@kagami/llm-api/contract";
import type {
  LlmClient,
  LlmChatOptions,
  LlmChatDirectOptions,
  LlmChatDirectResult,
  LlmChatRequest,
  LlmChatResponsePayload,
  LlmListAvailableProvidersOptions,
} from "@kagami/llm-client";
import type { LlmProviderOption } from "@kagami/llm-api/llm-chat";

// isRetryableLlmFailure 精确匹配这个 message 决定退避重试；createClient 的兜底错误（不可达/超时/
// 非 2xx 无富信封/响应体无效）必须沿用它。富错误信封 { error: BizErrorWire } 由 createClient 默认
// decodeError 重建成等价 BizError，保住 retry 语义与"未知工具走 tool_result"路径。
const LLM_UNREACHABLE_MESSAGE = "LLM 上游服务调用失败";

// createClient 的默认超时（服务真挂/半开兜底）。chat/chat-direct 各自的 600s、providers 的 30s
// 都由 llmApiContract 的 timeoutMs 逐路由覆盖，此默认只在契约未指定时兜底。
const DEFAULT_CLIENT_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

/**
 * 把 LLM 调用经 HTTP 打到独立的 kagami-llm 进程。实现 @kagami/llm-client 的 LlmClient 接口，
 * 因此 agent-runtime.factory 及所有下游消费者只把构造点从 createLlmClient 换成 new
 * HttpLlmClient，其余零改动。
 *
 * 三条路由（chat / chat-direct / providers）全走 @kagami/llm-api 契约驱动的 createClient：wire 序列化、
 * 超时、错误通道（BizError 富信封重建 + 不可达归一为 LLM_UNREACHABLE_MESSAGE）统一在 rpc-client。
 * chat/chat-direct 是信封级（契约 output `z.unknown()`，复杂 union 不逐字段校验），故对返回值按 LlmClient
 * 接口类型断言；providers 是全类型化路由，返回类型由契约 output 反推、与服务端 handler 同源。
 */
export class HttpLlmClient implements LlmClient {
  private readonly api: JsonClient<typeof llmApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.api = createClient(llmApiContract, {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      timeoutMs: DEFAULT_CLIENT_TIMEOUT_MS,
      unreachableMessage: LLM_UNREACHABLE_MESSAGE,
    });
  }

  public async chat(
    request: LlmChatRequest,
    options: LlmChatOptions,
  ): Promise<LlmChatResponsePayload> {
    return (await this.api.chat({
      request,
      usage: options.usage,
      ...(options.recordCall === undefined ? {} : { recordCall: options.recordCall }),
    })) as LlmChatResponsePayload;
  }

  public async chatDirect(
    request: LlmChatRequest,
    options: LlmChatDirectOptions,
  ): Promise<LlmChatDirectResult> {
    return (await this.api.chatDirect({
      request,
      providerId: options.providerId,
      model: options.model,
      ...(options.recordCall === undefined ? {} : { recordCall: options.recordCall }),
    })) as LlmChatDirectResult;
  }

  public async listAvailableProviders(
    options: LlmListAvailableProvidersOptions,
  ): Promise<LlmProviderOption[]> {
    return this.api.listProviders({ usage: options.usage });
  }
}
