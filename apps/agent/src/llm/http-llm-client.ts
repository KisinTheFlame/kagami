import { BizError } from "@kagami/kernel/errors/biz-error";
import { bizErrorFromWire, isBizErrorWire } from "@kagami/kernel/errors/biz-error-wire";
import type {
  LlmClient,
  LlmChatOptions,
  LlmChatDirectOptions,
  LlmChatDirectResult,
  LlmChatRequest,
  LlmChatResponsePayload,
  LlmListAvailableProvidersOptions,
} from "@kagami/llm-client";
import type { LlmProviderOption } from "@kagami/shared/schemas/llm-chat";

type FetchLike = typeof fetch;

// 客户端超时是「服务真挂/半开」的兜底，不是每次 chat 的时限。服务端每个 provider attempt 有自己的
// timeoutMs、且可能多 attempt 串行（usageConfig.attempts），总耗时可达 attempts × timeoutMs。这里给
// 一个远高于任何现实多-attempt 总时长的上限（10 分钟），确保**服务端 provider 超时永远先触发**、
// 回出规整 BizError，避免 client 先 abort 却让服务端 in-flight 上游请求继续跑（重复调用 + 成本放大）。
const CHAT_CLIENT_TIMEOUT_MS = 600_000;
const QUERY_CLIENT_TIMEOUT_MS = 30_000;

/**
 * 把 LLM 调用经 HTTP 打到独立的 kagami-llm 进程。实现 @kagami/llm-client 的 LlmClient 接口，
 * 因此 agent-runtime.factory 及所有下游消费者只把构造点从 createLlmClient 换成 new
 * HttpLlmClient，其余零改动。
 *
 * - 非 2xx 且带富错误信封 `{ error: BizErrorWire }`：重建等价 BizError 抛出（含 message/meta/
 *   statusCode）——保住 isRetryableLlmFailure 的 retry 语义与"未知工具走 tool_result"路径。
 * - 服务不可达 / 超时 / 无效响应：统一映射成 BizError("LLM 上游服务调用失败")——它既是
 *   isRetryableLlmFailure 的重试消息之一，语义上也正是"上游 LLM 服务调用失败"，让 agent 退避重试。
 */
export class HttpLlmClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async chat(
    request: LlmChatRequest,
    options: LlmChatOptions,
  ): Promise<LlmChatResponsePayload> {
    return (await this.post(
      "/internal/chat",
      {
        request,
        usage: options.usage,
        ...(options.recordCall === undefined ? {} : { recordCall: options.recordCall }),
      },
      CHAT_CLIENT_TIMEOUT_MS,
    )) as LlmChatResponsePayload;
  }

  public async chatDirect(
    request: LlmChatRequest,
    options: LlmChatDirectOptions,
  ): Promise<LlmChatDirectResult> {
    return (await this.post(
      "/internal/chat-direct",
      {
        request,
        providerId: options.providerId,
        model: options.model,
        ...(options.recordCall === undefined ? {} : { recordCall: options.recordCall }),
      },
      CHAT_CLIENT_TIMEOUT_MS,
    )) as LlmChatDirectResult;
  }

  public async listAvailableProviders(
    options: LlmListAvailableProvidersOptions,
  ): Promise<LlmProviderOption[]> {
    const search = new URLSearchParams({ usage: options.usage });
    return (await this.request(
      `/internal/providers?${search.toString()}`,
      QUERY_CLIENT_TIMEOUT_MS,
      { method: "GET" },
    )) as LlmProviderOption[];
  }

  private async post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    return this.request(path, timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request(path: string, timeoutMs: number, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BizError({
        message: "LLM 上游服务调用失败",
        meta: { reason: "unreachable" },
        cause: error,
      });
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (payload && isBizErrorWire(payload.error)) {
        throw bizErrorFromWire(payload.error);
      }
      throw new BizError({
        message: "LLM 上游服务调用失败",
        meta: { reason: "bad_status", status: response.status },
      });
    }

    try {
      return await response.json();
    } catch {
      throw new BizError({
        message: "LLM 上游服务调用失败",
        meta: { reason: "invalid_response_body" },
      });
    }
  }
}
