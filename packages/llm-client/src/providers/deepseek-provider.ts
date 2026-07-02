import type { Config } from "@kagami/kernel/config/config.loader";
import type { LlmProvider } from "../provider.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible-provider.js";

type LlmProviderConfig = Config["server"]["llm"]["providers"]["deepseek"] & {
  timeoutMs: Config["server"]["llm"]["timeoutMs"];
};

/** DeepSeek 走 OpenAI 兼容协议，实现收敛在 openai-compatible-provider。 */
export function createDeepSeekProvider(
  config: LlmProviderConfig & { apiKey: string },
): LlmProvider {
  return createOpenAiCompatibleProvider({
    id: "deepseek",
    displayLabel: "DeepSeek",
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  });
}
