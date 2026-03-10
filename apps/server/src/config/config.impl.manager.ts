import type {
  BootConfig,
  BotProfileConfig,
  ConfigManager,
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
  private readonly tavilyConfig: TavilyConfig;
  private readonly botProfileConfig: BotProfileConfig;

  public constructor({ config }: DefaultConfigManagerOptions) {
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
      activeProvider: config.server.llm.activeProvider,
      timeoutMs: config.server.llm.timeoutMs,
      deepseek: {
        apiKey: config.server.llm.providers.deepseek.apiKey,
        baseUrl: config.server.llm.providers.deepseek.baseUrl,
        chatModel: config.server.llm.providers.deepseek.chatModel,
        timeoutMs: config.server.llm.timeoutMs,
      },
      openai: {
        apiKey: config.server.llm.providers.openai.apiKey,
        baseUrl: config.server.llm.providers.openai.baseUrl,
        chatModel: config.server.llm.providers.openai.chatModel,
        timeoutMs: config.server.llm.timeoutMs,
      },
      openaiCodex: {
        authFilePath: config.server.llm.providers.openaiCodex.authFilePath,
        baseUrl: config.server.llm.providers.openaiCodex.baseUrl,
        chatModel: config.server.llm.providers.openaiCodex.chatModel,
        refreshLeewayMs: config.server.llm.providers.openaiCodex.refreshLeewayMs,
        timeoutMs: config.server.llm.timeoutMs,
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

  public async getTavilyConfig(): Promise<TavilyConfig> {
    return this.tavilyConfig;
  }

  public async getBotProfileConfig(): Promise<BotProfileConfig> {
    return this.botProfileConfig;
  }
}
