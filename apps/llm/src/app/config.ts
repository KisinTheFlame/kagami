import { DefaultConfigManager } from "@kagami/kernel/config/config.impl.manager";
import { loadStaticConfig, type Config } from "@kagami/kernel/config/config.loader";
import type { ConfigManager } from "@kagami/kernel/config/config.manager";

export type LlmServiceConfig = {
  /** 监听端口，来自顶层 services.llm.port（单一事实来源，见 issue #162）。 */
  port: number;
  databaseUrl: string;
  config: Config;
  configManager: ConfigManager;
};

/**
 * kagami-llm 进程配置。端口取 `services.llm.port`；LLM provider / usages / embedding 与
 * OAuth 配置直接复用 `server.llm` / `server.agent.story.memory.embedding` —— 这些原本就是
 * LLM/凭据的配置，只是消费方从 agent 进程变成本服务进程。
 */
export async function loadLlmServiceConfig(): Promise<LlmServiceConfig> {
  const config = await loadStaticConfig();
  const configManager = new DefaultConfigManager({ config });
  return {
    port: config.services.llm.port,
    databaseUrl: config.server.databaseUrl,
    config,
    configManager,
  };
}
