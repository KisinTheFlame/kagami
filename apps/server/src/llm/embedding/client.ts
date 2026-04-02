import { createHash } from "node:crypto";
import type { Config } from "../../config/config.loader.js";
import { AppLogger } from "../../logger/logger.js";
import type { EmbeddingCacheDao } from "./cache.dao.js";
import { createGeminiEmbeddingProvider } from "./providers/gemini-provider.js";
import type { EmbeddingProvider } from "./provider.js";
import type { EmbeddingRequest, EmbeddingResponse } from "./types.js";

type StoryMemoryEmbeddingConfig = Config["server"]["agent"]["story"]["memory"]["embedding"];
const logger = new AppLogger({ source: "llm.embedding-client" });

export interface EmbeddingClient {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

type CreateEmbeddingClientOptions = {
  config: StoryMemoryEmbeddingConfig;
  cacheDao?: EmbeddingCacheDao;
  provider?: EmbeddingProvider;
};

export function createEmbeddingClient(options: CreateEmbeddingClientOptions): EmbeddingClient {
  const provider =
    options.provider ??
    createGeminiEmbeddingProvider({
      apiKey: options.config.apiKey,
      baseUrl: options.config.baseUrl,
      model: options.config.model,
    });

  return {
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const resolvedRequest = resolveEmbeddingRequest({
        request,
        config: options.config,
      });
      const cacheKey = {
        provider: provider.id,
        model: resolvedRequest.model,
        taskType: request.taskType,
        outputDimensionality: resolvedRequest.outputDimensionality,
        textHash: hashEmbeddingContent(request.content),
      } as const;

      if (options.cacheDao) {
        try {
          const cached = await options.cacheDao.findByKey(cacheKey);
          if (cached) {
            return {
              provider: cached.provider,
              model: cached.model,
              embedding: cached.embedding,
            };
          }
        } catch (error) {
          logCacheFailure("Failed to read embedding cache; falling back to provider", error, {
            event: "llm.embedding_cache.read_failed",
            provider: cacheKey.provider,
            model: cacheKey.model,
            taskType: cacheKey.taskType,
            outputDimensionality: cacheKey.outputDimensionality,
          });
        }
      }

      const response = await provider.embed({
        ...request,
        model: resolvedRequest.model,
        outputDimensionality: resolvedRequest.outputDimensionality,
      });

      if (options.cacheDao) {
        try {
          await options.cacheDao.save({
            ...cacheKey,
            text: request.content,
            embedding: response.embedding,
          });
        } catch (error) {
          logCacheFailure("Failed to write embedding cache", error, {
            event: "llm.embedding_cache.write_failed",
            provider: cacheKey.provider,
            model: cacheKey.model,
            taskType: cacheKey.taskType,
            outputDimensionality: cacheKey.outputDimensionality,
          });
        }
      }

      return response;
    },
  };
}

function resolveEmbeddingRequest(input: {
  request: EmbeddingRequest;
  config: StoryMemoryEmbeddingConfig;
}): {
  model: string;
  outputDimensionality: number;
} {
  return {
    model: input.request.model ?? input.config.model,
    outputDimensionality: input.request.outputDimensionality ?? input.config.outputDimensionality,
  };
}

function hashEmbeddingContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function logCacheFailure(message: string, error: unknown, metadata: Record<string, unknown>): void {
  try {
    logger.errorWithCause(message, error, metadata);
  } catch {
    // Logging is best-effort here; cache failures should not block embeddings.
  }
}
