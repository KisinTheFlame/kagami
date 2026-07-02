import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { llmApiContract } from "@kagami/llm-api/contract";
import type {
  EmbeddingClient,
  EmbeddingRequest,
  EmbeddingResponse,
} from "@kagami/llm-client/embedding";

// 与 HttpLlmClient 同源：isRetryableLlmFailure 精确匹配的兜底 message。
const LLM_UNREACHABLE_MESSAGE = "LLM 上游服务调用失败";

type FetchLike = typeof fetch;

/**
 * 把 embedding 调用经 HTTP 打到独立的 kagami-llm 进程。实现 EmbeddingClient 接口，供 agent 侧
 * 任何需要文本向量化的能力复用（构造点 new HttpEmbeddingClient 即可）。走 @kagami/llm-api 契约驱动
 * 的 createClient（embed 路由，信封级 output `z.unknown()`），wire / 超时 / 错误通道统一在 rpc-client。
 * embedding_cache 读写全在服务侧。当前无消费者，保留待将来记忆系统接线。
 */
export class HttpEmbeddingClient implements EmbeddingClient {
  private readonly api: JsonClient<typeof llmApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.api = createClient(llmApiContract, {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      unreachableMessage: LLM_UNREACHABLE_MESSAGE,
    });
  }

  public async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    return (await this.api.embed({ request })) as EmbeddingResponse;
  }
}
