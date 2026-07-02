import type { Config } from "@kagami/kernel/config/config.loader";
import type { LlmProvider } from "../provider.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible-provider.js";

type LlmProviderConfig = Config["server"]["llm"]["providers"]["openai"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

/** OpenAI 官方端点同样走 OpenAI 兼容协议，实现收敛在 openai-compatible-provider。 */
export function createOpenAiProvider(config: LlmProviderConfig & { apiKey: string }): LlmProvider {
  return createOpenAiCompatibleProvider({
    id: "openai",
    displayLabel: "OpenAI",
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  });
}
