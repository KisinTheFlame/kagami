export type EmbeddingProviderId = "google" | "tei-embedding-gemma";

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export type EmbeddingRequest = {
  content: string;
  taskType: EmbeddingTaskType;
  outputDimensionality: number;
  model?: string;
};

export type EmbeddingResponse = {
  provider: EmbeddingProviderId;
  model: string;
  embedding: number[];
};
