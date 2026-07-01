import { BizError } from "@kagami/kernel/errors/biz-error";
import { bizErrorFromWire, isBizErrorWire } from "@kagami/kernel/errors/biz-error-wire";
import type {
  EmbeddingClient,
  EmbeddingRequest,
  EmbeddingResponse,
} from "@kagami/llm-client/embedding";

type FetchLike = typeof fetch;

const EMBED_CLIENT_TIMEOUT_MS = 60_000;

/**
 * 把 embedding 调用经 HTTP 打到独立的 kagami-llm 进程。实现 EmbeddingClient 接口，story 的
 * memory-index / recall 只把构造点换成 new HttpEmbeddingClient，其余零改动。embedding_cache
 * 读写全在服务侧；story 的 HNSW 索引仍在 agent。错误按 BizError 富信封重建 / 不可达归一。
 */
export class HttpEmbeddingClient implements EmbeddingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/internal/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request }),
        signal: AbortSignal.timeout(EMBED_CLIENT_TIMEOUT_MS),
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
      return (await response.json()) as EmbeddingResponse;
    } catch {
      throw new BizError({
        message: "LLM 上游服务调用失败",
        meta: { reason: "invalid_response_body" },
      });
    }
  }
}
