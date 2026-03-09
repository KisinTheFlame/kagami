import { GaiaClientError, type GaiaClientErrorCode } from "@kisinwen/gaia-client";
import { z } from "zod";
import { readGaiaConfigValue } from "./gaia-http.impl.client.js";
import type {
  BootConfig,
  BotProfileConfig,
  ConfigManager,
  LlmRuntimeConfig,
  TavilyConfig,
} from "./config.manager.js";

type ConfigRecord = {
  key: string;
  value: string;
  updatedAt: string;
};

type ConfigReader = (key: string) => Promise<ConfigRecord>;

type DefaultConfigManagerOptions = {
  readConfig?: ConfigReader;
};

export const GAIA_CONFIG_KEYS = {
  databaseUrl: "kagami.database-url",
  port: "kagami.port",
  llmActiveProvider: "kagami.llm.active-provider",
  llmTimeoutMs: "kagami.llm.timeout-ms",
  deepseekApiKey: "kagami.deepseek.api-key",
  deepseekBaseUrl: "kagami.deepseek.base-url",
  deepseekChatModel: "kagami.deepseek.chat-model",
  openaiApiKey: "kagami.openai.api-key",
  openaiBaseUrl: "kagami.openai.base-url",
  openaiChatModel: "kagami.openai.chat-model",
  tavilyApiKey: "kagami.tavily.api-key",
  napcatWsUrl: "kagami.napcat.ws-url",
  napcatWsReconnectMs: "kagami.napcat.ws-reconnect-ms",
  napcatWsRequestTimeoutMs: "kagami.napcat.ws-request-timeout-ms",
  napcatListenGroupId: "kagami.napcat.listen-group-id",
  botQQ: "kagami.bot.qq",
} as const;

const UrlValueSchema = z.string().url();
const NonEmptyStringSchema = z.string().trim().min(1);
const EmptyStringSchema = z.string().trim().length(0);
const PositiveIntStringSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "必须是正整数",
      });
      return z.NEVER;
    }

    return parsed;
  });
const LlmProviderSchema = z.enum(["deepseek", "openai"]);

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

export class DefaultConfigManager implements ConfigManager {
  private readonly readConfig: ConfigReader;

  public constructor({ readConfig = readGaiaConfigValue }: DefaultConfigManagerOptions) {
    this.readConfig = readConfig;
  }

  public async getBootConfig(): Promise<BootConfig> {
    return {
      databaseUrl: await this.readRequiredValue(GAIA_CONFIG_KEYS.databaseUrl, UrlValueSchema),
      port: await this.readValue(GAIA_CONFIG_KEYS.port, PositiveIntStringSchema, 3000),
      napcat: {
        wsUrl: await this.readRequiredValue(GAIA_CONFIG_KEYS.napcatWsUrl, UrlValueSchema),
        reconnectMs: await this.readRequiredValue(
          GAIA_CONFIG_KEYS.napcatWsReconnectMs,
          PositiveIntStringSchema,
        ),
        requestTimeoutMs: await this.readRequiredValue(
          GAIA_CONFIG_KEYS.napcatWsRequestTimeoutMs,
          PositiveIntStringSchema,
        ),
        listenGroupId: await this.readRequiredValue(
          GAIA_CONFIG_KEYS.napcatListenGroupId,
          NonEmptyStringSchema,
        ),
      },
    };
  }

  public async getLlmRuntimeConfig(): Promise<LlmRuntimeConfig> {
    const timeoutMs = await this.readValue(
      GAIA_CONFIG_KEYS.llmTimeoutMs,
      PositiveIntStringSchema,
      45000,
    );

    return {
      activeProvider: await this.readValue(
        GAIA_CONFIG_KEYS.llmActiveProvider,
        LlmProviderSchema,
        "deepseek",
      ),
      timeoutMs,
      deepseek: {
        apiKey: await this.readOptionalValue(GAIA_CONFIG_KEYS.deepseekApiKey, NonEmptyStringSchema),
        baseUrl: await this.readValue(
          GAIA_CONFIG_KEYS.deepseekBaseUrl,
          UrlValueSchema,
          "https://api.deepseek.com",
        ),
        chatModel: await this.readValue(
          GAIA_CONFIG_KEYS.deepseekChatModel,
          NonEmptyStringSchema,
          "deepseek-chat",
        ),
        timeoutMs,
      },
      openai: {
        apiKey: await this.readOptionalValueAllowingEmpty(
          GAIA_CONFIG_KEYS.openaiApiKey,
          NonEmptyStringSchema,
        ),
        baseUrl: await this.readValueAllowingEmpty(
          GAIA_CONFIG_KEYS.openaiBaseUrl,
          UrlValueSchema,
          "https://api.openai.com/v1",
        ),
        chatModel: await this.readValueAllowingEmpty(
          GAIA_CONFIG_KEYS.openaiChatModel,
          NonEmptyStringSchema,
          "gpt-4o-mini",
        ),
        timeoutMs,
      },
    };
  }

  public async getTavilyConfig(): Promise<TavilyConfig> {
    return {
      apiKey: await this.readOptionalValue(GAIA_CONFIG_KEYS.tavilyApiKey, NonEmptyStringSchema),
    };
  }

  public async getBotProfileConfig(): Promise<BotProfileConfig> {
    return {
      botQQ: await this.readRequiredValue(GAIA_CONFIG_KEYS.botQQ, NonEmptyStringSchema),
    };
  }

  private async readRequiredValue<T>(
    key: string,
    schema: z.ZodType<T, z.ZodTypeDef, string>,
  ): Promise<T> {
    const rawValue = await this.readRawValue(key);
    if (rawValue === undefined) {
      throw new ConfigManagerError({
        code: "CONFIG_NOT_FOUND",
        key,
        message: `缺少必填配置：${key}`,
      });
    }

    return this.parseValue(key, rawValue, schema);
  }

  private async readOptionalValue<T>(
    key: string,
    schema: z.ZodType<T, z.ZodTypeDef, string>,
  ): Promise<T | undefined> {
    const rawValue = await this.readRawValue(key);
    if (rawValue === undefined) {
      return undefined;
    }

    return this.parseValue(key, rawValue, schema);
  }

  private async readOptionalValueAllowingEmpty<T>(
    key: string,
    schema: z.ZodType<T, z.ZodTypeDef, string>,
  ): Promise<T | undefined> {
    const rawValue = await this.readRawValue(key);
    if (rawValue === undefined || isEmptyStringValue(rawValue)) {
      return undefined;
    }

    return this.parseValue(key, rawValue, schema);
  }

  private async readValue<T>(
    key: string,
    schema: z.ZodType<T, z.ZodTypeDef, string>,
    fallback: T,
  ): Promise<T> {
    const rawValue = await this.readRawValue(key);
    if (rawValue === undefined) {
      return fallback;
    }

    return this.parseValue(key, rawValue, schema);
  }

  private async readValueAllowingEmpty<T>(
    key: string,
    schema: z.ZodType<T, z.ZodTypeDef, string>,
    fallback: T,
  ): Promise<T> {
    const rawValue = await this.readRawValue(key);
    if (rawValue === undefined || isEmptyStringValue(rawValue)) {
      return fallback;
    }

    return this.parseValue(key, rawValue, schema);
  }

  private parseValue<T>(
    key: string,
    rawValue: string,
    schema: z.ZodType<T, z.ZodTypeDef, string>,
  ): T {
    const parsed = schema.safeParse(rawValue);
    if (!parsed.success) {
      throw new ConfigManagerError({
        code: "CONFIG_INVALID",
        key,
        message: `配置值不合法：${key}`,
        cause: parsed.error,
      });
    }

    return parsed.data;
  }

  private async readRawValue(key: string): Promise<string | undefined> {
    try {
      const record = await this.readConfig(key);
      return record.value;
    } catch (error) {
      if (isConfigNotFoundError(error)) {
        return undefined;
      }

      throw new ConfigManagerError({
        code: "CONFIG_READ_FAILED",
        key,
        message: `读取配置失败：${key}`,
        cause: error,
      });
    }
  }
}

function isConfigNotFoundError(error: unknown): boolean {
  if (error instanceof GaiaClientError) {
    return error.code === ("HTTP_ERROR" satisfies GaiaClientErrorCode) && error.status === 404;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  return (
    "code" in error && error.code === "HTTP_ERROR" && "status" in error && error.status === 404
  );
}

function isEmptyStringValue(value: string): boolean {
  return EmptyStringSchema.safeParse(value).success;
}
