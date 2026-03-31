import type { Config } from "../../config/config.loader.js";
import { createGeminiEmbeddingProvider } from "./providers/gemini-provider.js";
import type { EmbeddingProvider } from "./provider.js";
import type { EmbeddingRequest, EmbeddingResponse } from "./types.js";

type StoryMemoryEmbeddingConfig = Config["server"]["agent"]["story"]["memory"]["embedding"];

export interface EmbeddingClient {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

type CreateEmbeddingClientOptions = {
  config: StoryMemoryEmbeddingConfig;
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

      const response = await provider.embed({
        ...request,
        model: resolvedRequest.model,
        outputDimensionality: resolvedRequest.outputDimensionality,
      });

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
