import { createHash } from "node:crypto";
import type { RagEmbeddingRuntimeConfig } from "../../config/config.manager.js";
import type { EmbeddingCacheDao } from "../../dao/embedding-cache.dao.js";
import { createGeminiEmbeddingProvider } from "./providers/gemini-provider.js";
import type { EmbeddingProvider } from "./provider.js";
import type { EmbeddingRequest, EmbeddingResponse } from "./types.js";

export interface EmbeddingClient {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

type CreateEmbeddingClientOptions = {
  config: RagEmbeddingRuntimeConfig;
  provider?: EmbeddingProvider;
  embeddingCacheDao?: EmbeddingCacheDao;
};

export function createEmbeddingClient(options: CreateEmbeddingClientOptions): EmbeddingClient {
  const provider =
    options.provider ??
    createGeminiEmbeddingProvider({
      apiKey: options.config.apiKey,
      baseUrl: options.config.baseUrl,
      model: options.config.model,
    });
  const embeddingCacheDao = options.embeddingCacheDao;

  return {
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const resolvedRequest = resolveEmbeddingRequest({
        request,
        provider,
        config: options.config,
      });
      if (embeddingCacheDao) {
        const cached = await embeddingCacheDao.findByKey({
          provider: resolvedRequest.provider,
          model: resolvedRequest.model,
          taskType: resolvedRequest.taskType,
          outputDimensionality: resolvedRequest.outputDimensionality,
          textHash: resolvedRequest.textHash,
        });
        if (cached) {
          return {
            provider: cached.provider as EmbeddingResponse["provider"],
            model: cached.model,
            embedding: cached.embedding,
          };
        }
      }

      const response = await provider.embed({
        ...request,
        model: resolvedRequest.model,
        outputDimensionality: resolvedRequest.outputDimensionality,
      });

      if (embeddingCacheDao) {
        await embeddingCacheDao.upsert({
          provider: resolvedRequest.provider,
          model: resolvedRequest.model,
          taskType: resolvedRequest.taskType,
          outputDimensionality: resolvedRequest.outputDimensionality,
          text: request.content,
          textHash: resolvedRequest.textHash,
          embedding: response.embedding,
        });
      }

      return response;
    },
  };
}

function resolveEmbeddingRequest(input: {
  request: EmbeddingRequest;
  provider: EmbeddingProvider;
  config: RagEmbeddingRuntimeConfig;
}): {
  provider: EmbeddingProvider["id"];
  model: string;
  taskType: EmbeddingRequest["taskType"];
  outputDimensionality: number;
  textHash: string;
} {
  return {
    provider: input.provider.id,
    model: input.request.model ?? input.config.model,
    taskType: input.request.taskType,
    outputDimensionality: input.request.outputDimensionality ?? input.config.outputDimensionality,
    textHash: hashEmbeddingText(input.request.content),
  };
}

function hashEmbeddingText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
