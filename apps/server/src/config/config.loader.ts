import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { BizError } from "../errors/biz-error.js";
import type { LlmProviderId, LlmUsageId } from "../llm/types.js";
import type { LlmUsageAttemptRuntimeConfig, LlmUsageRuntimeConfig } from "./config.manager.js";

const DEFAULT_PORT = 20003;
const DEFAULT_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_CODEX_AUTH_FILE_PATH = "~/.codex/auth.json";
const DEFAULT_OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_GEMINI_EMBEDDING_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY = 768;
const DEFAULT_RAG_TOP_K = 3;

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
const NonEmptyStringArraySchema = z.array(NonEmptyStringSchema).min(1);
const LlmProviderSchema = z.enum(["deepseek", "openai", "openai-codex"] satisfies [
  LlmProviderId,
  ...LlmProviderId[],
]);
const RagEmbeddingProviderSchema = z.literal("google");
const LlmUsageAttemptConfigSchema = z.object({
  provider: LlmProviderSchema,
  model: NonEmptyStringSchema,
  times: PositiveIntSchema.default(1),
});
const LlmUsageConfigSchema = z.object({
  attempts: z.array(LlmUsageAttemptConfigSchema).min(1),
});

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
      timeoutMs: PositiveIntSchema.default(DEFAULT_LLM_TIMEOUT_MS),
      providers: z.object({
        deepseek: z.object({
          apiKey: OptionalNonEmptyStringSchema,
          baseUrl: UrlSchema.default(DEFAULT_DEEPSEEK_BASE_URL),
          models: NonEmptyStringArraySchema,
        }),
        openai: z.object({
          apiKey: OptionalNonEmptyStringSchema,
          baseUrl: OpenAiDefaultableStringSchema.default(DEFAULT_OPENAI_BASE_URL),
          models: NonEmptyStringArraySchema,
        }),
        openaiCodex: z.object({
          authFilePath: z.string().trim().min(1).default(DEFAULT_OPENAI_CODEX_AUTH_FILE_PATH),
          baseUrl: UrlSchema.default(DEFAULT_OPENAI_CODEX_BASE_URL),
          models: NonEmptyStringArraySchema,
          refreshLeewayMs: PositiveIntSchema.default(DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS),
        }),
      }),
      usages: z
        .object({
          agent: LlmUsageConfigSchema,
          ragQueryPlanner: LlmUsageConfigSchema,
          contextSummarizer: LlmUsageConfigSchema,
        })
        .strict(),
    }),
    rag: z.object({
      embedding: z.object({
        provider: RagEmbeddingProviderSchema.default("google"),
        apiKey: NonEmptyStringSchema,
        baseUrl: UrlSchema.default(DEFAULT_GEMINI_EMBEDDING_BASE_URL),
        model: NonEmptyStringSchema.default(DEFAULT_GEMINI_EMBEDDING_MODEL),
        outputDimensionality: PositiveIntSchema.default(
          DEFAULT_GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY,
        ),
      }),
      retrieval: z
        .object({
          topK: PositiveIntSchema.default(DEFAULT_RAG_TOP_K),
        })
        .default({}),
    }),
    tavily: z.object({
      apiKey: NonEmptyStringSchema,
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
    throw new BizError({
      message: "读取配置文件失败",
      meta: {
        key: configPath,
        reason: "CONFIG_READ_FAILED",
      },
      cause: error,
    });
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parse(fileContent);
  } catch (error) {
    throw new BizError({
      message: "配置文件不是合法的 YAML",
      meta: {
        key: configPath,
        reason: "CONFIG_INVALID",
      },
      cause: error,
    });
  }

  const parsedConfig = StaticConfigFileSchema.safeParse(parsedYaml);
  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0];
    const key = issue?.path.length ? issue.path.join(".") : configPath;
    throw new BizError({
      message: "配置值不合法",
      meta: {
        key,
        reason: "CONFIG_INVALID",
      },
      cause: parsedConfig.error,
    });
  }

  return {
    ...parsedConfig.data,
    server: {
      ...parsedConfig.data.server,
      llm: {
        ...parsedConfig.data.server.llm,
        usages: normalizeLlmUsages(parsedConfig.data.server.llm),
      },
    },
  };
}

function normalizeLlmUsages(
  input: StaticConfig["server"]["llm"],
): Record<LlmUsageId, LlmUsageRuntimeConfig> {
  return {
    agent: normalizeUsageConfig(input.usages.agent),
    ragQueryPlanner: normalizeUsageConfig(input.usages.ragQueryPlanner),
    contextSummarizer: normalizeUsageConfig(input.usages.contextSummarizer),
  };
}

function normalizeUsageConfig(
  value: StaticConfig["server"]["llm"]["usages"]["agent"],
): LlmUsageRuntimeConfig {
  return {
    attempts: value.attempts.map(attempt => normalizeUsageAttempt(attempt)),
  };
}

function normalizeUsageAttempt(
  value: StaticConfig["server"]["llm"]["usages"]["agent"]["attempts"][number],
): LlmUsageAttemptRuntimeConfig {
  return {
    provider: value.provider,
    model: value.model,
    times: value.times,
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

  throw new BizError({
    message: "未找到 config.yaml",
    meta: {
      key: "config.yaml",
      reason: "CONFIG_NOT_FOUND",
    },
  });
}
