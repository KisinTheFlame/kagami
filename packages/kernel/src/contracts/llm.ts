// LLM 各调用点的用途标识（落库归因用）。provider 标识（`LlmProviderId`）的单源另在 @kagami/llm。
export type LlmUsageId =
  | "agent"
  | "contextSummarizer"
  | "vision"
  | "todoSuggestionAgent"
  | "innerVoice";
