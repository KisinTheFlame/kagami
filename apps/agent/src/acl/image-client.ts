import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { llmApiContract } from "@kagami/llm-api/contract";
import { llmUpstreamCallFailedError } from "@kagami/llm-client";
import type { ImageGenerationRequest } from "@kagami/llm-client/image";
import type { GenerateImageResult } from "@kagami/llm-api/image";

// createClient 默认超时兜底（服务真挂/半开）；generateImage 的 300s 由 llmApiContract 逐路由覆盖。
const DEFAULT_CLIENT_TIMEOUT_MS = 30_000;

type FetchLike = typeof fetch;

/**
 * 生图调用经 HTTP 打到独立的 kagami-llm 进程（`POST /internal/generate-image`）。刻意做成**专用薄
 * client**、不塞进 chat 语义的 LlmClient——生图与 chat/embed 是不同能力，混进去会牵连 LlmClient
 * 抽象。走 @kagami/llm-api 契约驱动的 createClient：wire 序列化 / 超时 / 错误通道统一在 rpc-client。
 *
 * generateImage 是信封级路由（契约 input/output `z.unknown()`，同 chat/embed），故请求按
 * ImageGenerationRequest 传、返回值按 GenerateImageResult 断言。
 */
export interface ImageClient {
  generate(request: ImageGenerationRequest): Promise<GenerateImageResult>;
}

export class HttpImageClient implements ImageClient {
  private readonly api: JsonClient<typeof llmApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
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

  public async generate(request: ImageGenerationRequest): Promise<GenerateImageResult> {
    return (await this.api.generateImage({ request })) as GenerateImageResult;
  }
}
