import type { RagEmbeddingRuntimeConfig } from "../../config/config.manager.js";
import { createGeminiEmbeddingProvider } from "./providers/gemini-provider.js";
import type { EmbeddingProvider } from "./provider.js";
import type { EmbeddingRequest, EmbeddingResponse } from "./types.js";

export interface EmbeddingClient {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

type CreateEmbeddingClientOptions = {
  config: RagEmbeddingRuntimeConfig;
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
      return await provider.embed({
        ...request,
        model: request.model ?? options.config.model,
        outputDimensionality: request.outputDimensionality ?? options.config.outputDimensionality,
      });
    },
  };
}
