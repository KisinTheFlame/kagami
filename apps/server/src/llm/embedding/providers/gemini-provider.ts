import { GoogleGenAI } from "@google/genai";
import { BizError } from "../../../common/errors/biz-error.js";
import type { EmbeddingProvider } from "../provider.js";
import type { EmbeddingRequest, EmbeddingResponse } from "../types.js";

type GeminiEmbeddingProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export function createGeminiEmbeddingProvider(
  options: GeminiEmbeddingProviderOptions,
): EmbeddingProvider {
  const endpoint = normalizeGeminiEndpoint(options.baseUrl);
  const ai = new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: {
      baseUrl: endpoint.baseUrl,
      apiVersion: endpoint.apiVersion,
    },
  });

  return {
    id: "google",
    async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
      const model = request.model ?? options.model;
      const response = await ai.models.embedContent({
        model,
        contents: request.content,
        config: {
          taskType: request.taskType,
          outputDimensionality: request.outputDimensionality,
        },
      });

      const values = response.embeddings?.[0]?.values;
      if (!Array.isArray(values) || values.some(value => typeof value !== "number")) {
        throw new BizError({
          message: "Gemini embedding response is missing embedding values",
          statusCode: 502,
        });
      }

      return {
        provider: "google",
        model,
        embedding: values,
      };
    },
  };
}

function normalizeGeminiEndpoint(value: string): {
  baseUrl: string;
  apiVersion: string;
} {
  const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
  const matched = trimmed.match(/^(https:\/\/[^/]+)(?:\/(v1alpha|v1beta|v1))?$/);

  if (!matched) {
    return {
      baseUrl: trimmed,
      apiVersion: "v1beta",
    };
  }

  return {
    baseUrl: matched[1],
    apiVersion: matched[2] ?? "v1beta",
  };
}
