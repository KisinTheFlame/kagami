export type LlmModelCapabilities = {
  supportsTextInput: boolean;
  supportsImageInput: boolean;
};

export const LLM_MODEL_CAPABILITIES: Record<string, LlmModelCapabilities> = {
  "deepseek-chat": {
    supportsTextInput: true,
    supportsImageInput: false,
  },
  "deepseek-reasoner": {
    supportsTextInput: true,
    supportsImageInput: false,
  },
  "gpt-4o-mini": {
    supportsTextInput: true,
    supportsImageInput: true,
  },
  "gpt-5.3-codex": {
    supportsTextInput: true,
    supportsImageInput: false,
  },
  "gpt-5.4": {
    supportsTextInput: true,
    supportsImageInput: true,
  },
};

export function getLlmModelCapabilities(model: string): LlmModelCapabilities | null {
  return LLM_MODEL_CAPABILITIES[model] ?? null;
}
