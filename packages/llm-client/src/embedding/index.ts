import { createEmbeddingClient, type EmbeddingClient } from "./client.js";
import type { EmbeddingProvider } from "./provider.js";
import type {
  EmbeddingProviderId,
  EmbeddingTaskType,
  EmbeddingRequest,
  EmbeddingResponse,
} from "./types.js";
import type { EmbeddingCacheKey, EmbeddingCacheRecord, EmbeddingCacheDao } from "./cache.dao.js";

export {
  createEmbeddingClient,
  type EmbeddingClient,
  type EmbeddingProvider,
  type EmbeddingProviderId,
  type EmbeddingTaskType,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type EmbeddingCacheKey,
  type EmbeddingCacheRecord,
  type EmbeddingCacheDao,
};
