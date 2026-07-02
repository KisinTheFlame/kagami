// provider 标识的单源在 @kagami/llm，需要 `LlmProviderId` 的代码请直接从那里导入。
export type LlmUsageId =
  | "agent"
  | "contextSummarizer"
  | "vision"
  | "webSearchAgent"
  | "todoSuggestionAgent";
