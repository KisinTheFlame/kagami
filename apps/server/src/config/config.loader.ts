import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { ConfigManagerError } from "./config.impl.manager.js";
import type { LlmProviderId } from "../llm/types.js";

const DEFAULT_PORT = 20003;
const DEFAULT_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_CHAT_MODEL = "deepseek-chat";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_CHAT_MODEL = "gpt-4o-mini";

const UrlSchema = z.string().url();
const NonEmptyStringSchema = z.string().trim().min(1);
const OptionalNonEmptyStringSchema = z
  .string()
  .trim()
  .transform(value => (value.length === 0 ? undefined : value))
  .optional();
const PositiveIntSchema = z.preprocess(value => {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}, z.number().int().positive());
const StringLikeSchema = z.preprocess(value => {
  if (typeof value === "number") {
    return String(value);
  }

  return value;
}, z.string().trim().min(1));
const OpenAiDefaultableStringSchema = z.preprocess(value => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }

  return value;
}, z.string().trim().min(1).optional());
const ActiveProviderSchema = z.enum(["deepseek", "openai"] satisfies [
  LlmProviderId,
  ...LlmProviderId[],
]);

const StaticConfigFileSchema = z.object({
  server: z.object({
    databaseUrl: UrlSchema,
    port: PositiveIntSchema.default(DEFAULT_PORT),
    napcat: z.object({
      wsUrl: UrlSchema,
      reconnectMs: PositiveIntSchema,
      requestTimeoutMs: PositiveIntSchema,
      listenGroupId: StringLikeSchema,
    }),
    llm: z.object({
      activeProvider: ActiveProviderSchema.default("deepseek"),
      timeoutMs: PositiveIntSchema.default(DEFAULT_LLM_TIMEOUT_MS),
      providers: z.object({
        deepseek: z.object({
          apiKey: OptionalNonEmptyStringSchema,
          baseUrl: UrlSchema.default(DEFAULT_DEEPSEEK_BASE_URL),
          chatModel: NonEmptyStringSchema.default(DEFAULT_DEEPSEEK_CHAT_MODEL),
        }),
        openai: z.object({
          apiKey: OptionalNonEmptyStringSchema,
          baseUrl: OpenAiDefaultableStringSchema.default(DEFAULT_OPENAI_BASE_URL),
          chatModel: OpenAiDefaultableStringSchema.default(DEFAULT_OPENAI_CHAT_MODEL),
        }),
      }),
    }),
    tavily: z.object({
      apiKey: OptionalNonEmptyStringSchema,
    }),
    bot: z.object({
      qq: StringLikeSchema,
    }),
  }),
});

export type StaticConfig = z.infer<typeof StaticConfigFileSchema>;

type LoadStaticConfigOptions = {
  configPath?: string;
};

export async function loadStaticConfig(
  options: LoadStaticConfigOptions = {},
): Promise<StaticConfig> {
  const configPath = options.configPath ?? resolveConfigPath();

  let fileContent: string;
  try {
    fileContent = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigManagerError({
      code: "CONFIG_READ_FAILED",
      key: configPath,
      message: `读取配置文件失败：${configPath}`,
      cause: error,
    });
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parse(fileContent);
  } catch (error) {
    throw new ConfigManagerError({
      code: "CONFIG_INVALID",
      key: configPath,
      message: `配置文件不是合法的 YAML：${configPath}`,
      cause: error,
    });
  }

  const parsedConfig = StaticConfigFileSchema.safeParse(parsedYaml);
  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0];
    const key = issue?.path.length ? issue.path.join(".") : configPath;
    throw new ConfigManagerError({
      code: "CONFIG_INVALID",
      key,
      message: `配置值不合法：${key}`,
      cause: parsedConfig.error,
    });
  }

  return {
    ...parsedConfig.data,
    server: {
      ...parsedConfig.data.server,
      llm: {
        ...parsedConfig.data.server.llm,
        providers: {
          ...parsedConfig.data.server.llm.providers,
          openai: {
            ...parsedConfig.data.server.llm.providers.openai,
            baseUrl:
              parsedConfig.data.server.llm.providers.openai.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
            chatModel:
              parsedConfig.data.server.llm.providers.openai.chatModel ?? DEFAULT_OPENAI_CHAT_MODEL,
          },
        },
      },
    },
  };
}

function resolveConfigPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "config.yaml"),
    path.resolve(process.cwd(), "../../config.yaml"),
    fileURLToPath(new URL("../../../../config.yaml", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new ConfigManagerError({
    code: "CONFIG_NOT_FOUND",
    key: "config.yaml",
    message: "未找到 config.yaml",
  });
}
