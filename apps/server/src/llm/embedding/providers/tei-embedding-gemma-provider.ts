import { BizError } from "../../../common/errors/biz-error.js";
import type { EmbeddingProvider } from "../provider.js";
import type { EmbeddingRequest, EmbeddingResponse } from "../types.js";

type TeiEmbeddingGemmaProviderOptions = {
  baseUrl: string;
  model: string;
};

export function createTeiEmbeddingGemmaProvider(
  options: TeiEmbeddingGemmaProviderOptions,
): EmbeddingProvider {
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return {
    id: "tei-embedding-gemma",
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const response = await fetch(`${baseUrl}/embed`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          inputs: request.content,
        }),
      });

      if (!response.ok) {
        throw new BizError({
          message: "TEI Embedding Gemma 请求失败",
          statusCode: 502,
          meta: {
            status: response.status,
            statusText: response.statusText,
          },
        });
      }

      const payload: unknown = await response.json();
      const embedding: unknown = Array.isArray(payload) ? payload[0] : undefined;
      if (!Array.isArray(embedding) || embedding.some(value => typeof value !== "number")) {
        throw new BizError({
          message: "TEI Embedding Gemma 响应缺少合法 embedding",
          statusCode: 502,
        });
      }

      return {
        provider: "tei-embedding-gemma",
        model: options.model,
        embedding: embedding as number[],
      };
    },
  };
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
