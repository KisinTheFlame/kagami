import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { llmApiContract } from "@kagami/llm-api/contract";
import { llmUpstreamCallFailedError } from "@kagami/llm-client";
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

// 与 agent 侧 acl/http-llm-client 同构（都是 llm-api 契约驱动的薄封装）；napcat 拆成独立进程后
// 各持一份，避免跨 app 依赖。napcat 只用它给 vision 拨 kagami-llm。
const DEFAULT_CLIENT_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

/**
 * 把 LLM 调用经 HTTP 打到独立的 kagami-llm 进程，实现 @kagami/llm-client 的 LlmClient 接口。
 * napcat 用它构造 VisionAgent 给入站图片跑 vision 描述。
 */
export class HttpLlmClient implements LlmClient {
  private readonly api: JsonClient<typeof llmApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    // 兜底错误统一走 llmUpstreamCallFailedError 工厂盖 meta.retryable 标记（见 agent 侧同构说明、#435）。
    this.api = createClient(llmApiContract, {
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      timeoutMs: DEFAULT_CLIENT_TIMEOUT_MS,
      mapFallbackError: info =>
        llmUpstreamCallFailedError({
          meta: {
            reason: info.reason,
            ...(info.reason === "bad_status" ? { status: info.status } : {}),
          },
          ...(info.reason === "bad_status" ? {} : { cause: info.cause }),
        }),
    });
  }

  public async chat(
    request: LlmChatRequest,
    options: LlmChatOptions,
  ): Promise<LlmChatResponsePayload> {
    return (await this.api.chat({
      request,
      usage: options.usage,
      scene: options.scene,
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
