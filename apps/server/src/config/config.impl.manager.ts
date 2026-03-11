import type {
  BootConfig,
  BotProfileConfig,
  ConfigManager,
  RagRuntimeConfig,
  LlmRuntimeConfig,
  TavilyConfig,
} from "./config.manager.js";
import type { StaticConfig } from "./config.loader.js";

export type ConfigManagerErrorCode = "CONFIG_NOT_FOUND" | "CONFIG_INVALID" | "CONFIG_READ_FAILED";

export class ConfigManagerError extends Error {
  public readonly code: ConfigManagerErrorCode;
  public readonly key: string;
  public readonly cause?: unknown;

  public constructor({
    code,
    key,
    message,
    cause,
  }: {
    code: ConfigManagerErrorCode;
    key: string;
    message: string;
    cause?: unknown;
  }) {
    super(message);
    this.name = "ConfigManagerError";
    this.code = code;
    this.key = key;
    this.cause = cause;
  }
}

type DefaultConfigManagerOptions = {
  config: StaticConfig;
};

export class DefaultConfigManager implements ConfigManager {
  private readonly bootConfig: BootConfig;
  private readonly llmRuntimeConfig: LlmRuntimeConfig;
  private readonly ragRuntimeConfig: RagRuntimeConfig;
  private readonly tavilyConfig: TavilyConfig;
  private readonly botProfileConfig: BotProfileConfig;

  public constructor({ config }: DefaultConfigManagerOptions) {
    const llmUsages = config.server.llm.usages as LlmRuntimeConfig["usages"];

    this.bootConfig = {
      databaseUrl: config.server.databaseUrl,
      port: config.server.port,
      napcat: {
        wsUrl: config.server.napcat.wsUrl,
        reconnectMs: config.server.napcat.reconnectMs,
        requestTimeoutMs: config.server.napcat.requestTimeoutMs,
        listenGroupId: config.server.napcat.listenGroupId,
      },
    };

    this.llmRuntimeConfig = {
      timeoutMs: config.server.llm.timeoutMs,
      deepseek: {
        apiKey: config.server.llm.providers.deepseek.apiKey,
        baseUrl: config.server.llm.providers.deepseek.baseUrl,
        models: config.server.llm.providers.deepseek.models,
        timeoutMs: config.server.llm.timeoutMs,
      },
      openai: {
        apiKey: config.server.llm.providers.openai.apiKey,
        baseUrl: config.server.llm.providers.openai.baseUrl,
        models: config.server.llm.providers.openai.models,
        timeoutMs: config.server.llm.timeoutMs,
      },
      openaiCodex: {
        authFilePath: config.server.llm.providers.openaiCodex.authFilePath,
        baseUrl: config.server.llm.providers.openaiCodex.baseUrl,
        models: config.server.llm.providers.openaiCodex.models,
        refreshLeewayMs: config.server.llm.providers.openaiCodex.refreshLeewayMs,
        timeoutMs: config.server.llm.timeoutMs,
      },
      usages: {
        agent: {
          attempts: llmUsages.agent.attempts.map(attempt => ({
            provider: attempt.provider,
            model: attempt.model,
            times: attempt.times,
          })),
        },
        ragQueryPlanner: {
          attempts: llmUsages.ragQueryPlanner.attempts.map(attempt => ({
            provider: attempt.provider,
            model: attempt.model,
            times: attempt.times,
          })),
        },
      },
    };

    this.ragRuntimeConfig = {
      embedding: {
        provider: config.server.rag.embedding.provider,
        apiKey: config.server.rag.embedding.apiKey,
        baseUrl: config.server.rag.embedding.baseUrl,
        model: config.server.rag.embedding.model,
        outputDimensionality: config.server.rag.embedding.outputDimensionality,
      },
      retrieval: {
        topK: config.server.rag.retrieval.topK,
      },
    };

    this.tavilyConfig = {
      apiKey: config.server.tavily.apiKey,
    };

    this.botProfileConfig = {
      botQQ: config.server.bot.qq,
    };
  }

  public async getBootConfig(): Promise<BootConfig> {
    return this.bootConfig;
  }

  public async getLlmRuntimeConfig(): Promise<LlmRuntimeConfig> {
    return this.llmRuntimeConfig;
  }

  public async getRagRuntimeConfig(): Promise<RagRuntimeConfig> {
    return this.ragRuntimeConfig;
  }

  public async getTavilyConfig(): Promise<TavilyConfig> {
    return this.tavilyConfig;
  }

  public async getBotProfileConfig(): Promise<BotProfileConfig> {
    return this.botProfileConfig;
  }
}
