import type { EmbeddingProviderId, EmbeddingRequest, EmbeddingResponse } from "./types.js";

export interface EmbeddingProvider {
  id: EmbeddingProviderId;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
