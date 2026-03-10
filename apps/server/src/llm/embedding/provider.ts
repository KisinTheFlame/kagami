import type { EmbeddingRequest, EmbeddingResponse } from "./types.js";

export interface EmbeddingProvider {
  id: "google";
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
