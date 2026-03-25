import type {
  BootConfig,
  BotProfileConfig,
  ClaudeCodeAuthRuntimeConfig,
  CodexAuthRuntimeConfig,
  ConfigManager,
  RagRuntimeConfig,
  LlmRuntimeConfig,
  TavilyConfig,
} from "./config.manager.js";
import type { StaticConfig } from "./config.loader.js";

type DefaultConfigManagerOptions = {
  config: StaticConfig;
};

export class DefaultConfigManager implements ConfigManager {
  private readonly bootConfig: BootConfig;
  private readonly llmRuntimeConfig: LlmRuntimeConfig;
  private readonly codexAuthRuntimeConfig: CodexAuthRuntimeConfig;
  private readonly claudeCodeAuthRuntimeConfig: ClaudeCodeAuthRuntimeConfig;
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
        listenGroupIds: config.server.napcat.listenGroupIds,
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
        baseUrl: config.server.llm.providers.openaiCodex.baseUrl,
        models: config.server.llm.providers.openaiCodex.models,
        timeoutMs: config.server.llm.timeoutMs,
      },
      claudeCode: {
        apiKey: undefined,
        baseUrl: config.server.llm.providers.claudeCode.baseUrl,
        models: config.server.llm.providers.claudeCode.models,
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
        contextSummarizer: {
          attempts: llmUsages.contextSummarizer.attempts.map(attempt => ({
            provider: attempt.provider,
            model: attempt.model,
            times: attempt.times,
          })),
        },
        vision: {
          attempts: llmUsages.vision.attempts.map(attempt => ({
            provider: attempt.provider,
            model: attempt.model,
            times: attempt.times,
          })),
        },
        replyDecider: {
          attempts: llmUsages.replyDecider.attempts.map(attempt => ({
            provider: attempt.provider,
            model: attempt.model,
            times: attempt.times,
          })),
        },
      },
    };

    this.codexAuthRuntimeConfig = {
      enabled: config.server.llm.codexAuth.enabled,
      publicBaseUrl: config.server.llm.codexAuth.publicBaseUrl,
      oauthRedirectPath: config.server.llm.codexAuth.oauthRedirectPath,
      oauthStateTtlMs: config.server.llm.codexAuth.oauthStateTtlMs,
      refreshLeewayMs: config.server.llm.codexAuth.refreshLeewayMs,
      timeoutMs: config.server.llm.timeoutMs,
      binaryPath: config.server.llm.codexAuth.binaryPath,
    };

    this.claudeCodeAuthRuntimeConfig = {
      enabled: config.server.llm.claudeCodeAuth.enabled,
      publicBaseUrl: config.server.llm.claudeCodeAuth.publicBaseUrl,
      oauthRedirectPath: config.server.llm.claudeCodeAuth.oauthRedirectPath,
      oauthStateTtlMs: config.server.llm.claudeCodeAuth.oauthStateTtlMs,
      refreshLeewayMs: config.server.llm.claudeCodeAuth.refreshLeewayMs,
      timeoutMs: config.server.llm.timeoutMs,
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

  public async getCodexAuthRuntimeConfig(): Promise<CodexAuthRuntimeConfig> {
    return this.codexAuthRuntimeConfig;
  }

  public async getClaudeCodeAuthRuntimeConfig(): Promise<ClaudeCodeAuthRuntimeConfig> {
    return this.claudeCodeAuthRuntimeConfig;
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
