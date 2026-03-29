import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { z } from "zod";
import { BizError } from "../common/errors/biz-error.js";
import type { LlmProviderId, LlmUsageId } from "../common/contracts/llm.js";

const DEFAULT_PORT = 20003;
const DEFAULT_NAPCAT_STARTUP_CONTEXT_RECENT_MESSAGE_COUNT = 40;
const DEFAULT_AGENT_PORTAL_SLEEP_MS = 30_000;
const DEFAULT_AGENT_CONTEXT_COMPACTION_THRESHOLD = 60;
const DEFAULT_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_CLAUDE_CODE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_CLAUDE_CODE_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES = 30;
const DEFAULT_CODEX_AUTH_ENABLED = true;
const DEFAULT_CODEX_AUTH_PUBLIC_BASE_URL = "http://localhost:20004";
const DEFAULT_CODEX_AUTH_REDIRECT_PATH = "/auth/callback";
const DEFAULT_CODEX_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_CODEX_AUTH_BINARY_PATH = "codex";
const DEFAULT_CLAUDE_CODE_AUTH_ENABLED = true;
const DEFAULT_CLAUDE_CODE_AUTH_PUBLIC_BASE_URL = "http://localhost:20004";
const DEFAULT_CLAUDE_CODE_AUTH_REDIRECT_PATH = "/callback";
const DEFAULT_CLAUDE_CODE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLAUDE_CODE_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_CLAUDE_CODE_REFRESH_CHECK_INTERVAL_MS = 60_000;
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
const NonNegativeIntSchema = z.preprocess(value => {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}, z.number().int().nonnegative());
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
const StringLikeArraySchema = z.array(StringLikeSchema).min(1);
const LlmProviderSchema = z.enum(["deepseek", "openai", "openai-codex", "claude-code"] satisfies [
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
const NapcatConfigSchema = z.preprocess(
  value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    if (!("listenGroupId" in record)) {
      return value;
    }

    return {
      ...record,
      listenGroupIds:
        "listenGroupIds" in record ? record.listenGroupIds : ["__legacy_listen_group_id__"],
      __legacyListenGroupId__: record.listenGroupId,
    };
  },
  z
    .object({
      wsUrl: UrlSchema,
      reconnectMs: PositiveIntSchema,
      requestTimeoutMs: PositiveIntSchema,
      listenGroupIds: StringLikeArraySchema,
      startupContextRecentMessageCount: NonNegativeIntSchema.default(
        DEFAULT_NAPCAT_STARTUP_CONTEXT_RECENT_MESSAGE_COUNT,
      ),
      __legacyListenGroupId__: z.unknown().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.__legacyListenGroupId__ !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["listenGroupId"],
          message: "listenGroupId 已废弃，请改用 listenGroupIds",
        });
      }
    })
    .transform(value => ({
      wsUrl: value.wsUrl,
      reconnectMs: value.reconnectMs,
      requestTimeoutMs: value.requestTimeoutMs,
      listenGroupIds: value.listenGroupIds,
      startupContextRecentMessageCount: value.startupContextRecentMessageCount,
    })),
);

const ConfigSchema = z.object({
  server: z.object({
    databaseUrl: UrlSchema,
    port: PositiveIntSchema.default(DEFAULT_PORT),
    agent: z
      .object({
        portalSleepMs: PositiveIntSchema.default(DEFAULT_AGENT_PORTAL_SLEEP_MS),
        contextCompactionThreshold: PositiveIntSchema.default(
          DEFAULT_AGENT_CONTEXT_COMPACTION_THRESHOLD,
        ),
      })
      .default({}),
    napcat: NapcatConfigSchema,
    llm: z.object({
      timeoutMs: PositiveIntSchema.default(DEFAULT_LLM_TIMEOUT_MS),
      codexAuth: z
        .object({
          enabled: z.boolean().default(DEFAULT_CODEX_AUTH_ENABLED),
          publicBaseUrl: UrlSchema.default(DEFAULT_CODEX_AUTH_PUBLIC_BASE_URL),
          oauthRedirectPath: z.string().trim().min(1).default(DEFAULT_CODEX_AUTH_REDIRECT_PATH),
          oauthStateTtlMs: PositiveIntSchema.default(DEFAULT_CODEX_AUTH_STATE_TTL_MS),
          refreshLeewayMs: PositiveIntSchema.default(DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS),
          binaryPath: NonEmptyStringSchema.default(DEFAULT_CODEX_AUTH_BINARY_PATH),
        })
        .default({}),
      claudeCodeAuth: z
        .object({
          enabled: z.boolean().default(DEFAULT_CLAUDE_CODE_AUTH_ENABLED),
          publicBaseUrl: UrlSchema.default(DEFAULT_CLAUDE_CODE_AUTH_PUBLIC_BASE_URL),
          oauthRedirectPath: z
            .string()
            .trim()
            .min(1)
            .default(DEFAULT_CLAUDE_CODE_AUTH_REDIRECT_PATH),
          oauthStateTtlMs: PositiveIntSchema.default(DEFAULT_CLAUDE_CODE_AUTH_STATE_TTL_MS),
          refreshLeewayMs: PositiveIntSchema.default(DEFAULT_CLAUDE_CODE_REFRESH_LEEWAY_MS),
          refreshCheckIntervalMs: PositiveIntSchema.default(
            DEFAULT_CLAUDE_CODE_REFRESH_CHECK_INTERVAL_MS,
          ),
        })
        .default({}),
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
          baseUrl: UrlSchema.default(DEFAULT_OPENAI_CODEX_BASE_URL),
          models: NonEmptyStringArraySchema,
        }),
        claudeCode: z
          .object({
            baseUrl: UrlSchema.default(DEFAULT_CLAUDE_CODE_BASE_URL),
            models: NonEmptyStringArraySchema,
            keepAliveReplayIntervalMinutes: PositiveIntSchema.default(
              DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES,
            ),
          })
          .default({
            models: [DEFAULT_CLAUDE_CODE_MODEL],
            keepAliveReplayIntervalMinutes: DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES,
          }),
      }),
      usages: z
        .object({
          agent: LlmUsageConfigSchema,
          contextSummarizer: LlmUsageConfigSchema,
          vision: LlmUsageConfigSchema,
          webSearchAgent: LlmUsageConfigSchema,
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

type LlmUsageAttemptConfig = {
  provider: LlmProviderId;
  model: string;
  times: number;
};

type LlmUsageConfig = {
  attempts: LlmUsageAttemptConfig[];
};

export type Config = z.infer<typeof ConfigSchema>;

type LoadStaticConfigOptions = {
  configPath?: string;
};

export async function loadStaticConfig(options: LoadStaticConfigOptions = {}): Promise<Config> {
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

  const parsedConfig = ConfigSchema.safeParse(parsedYaml);
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

function normalizeLlmUsages(input: Config["server"]["llm"]): Record<LlmUsageId, LlmUsageConfig> {
  return {
    agent: normalizeUsageConfig(input.usages.agent),
    contextSummarizer: normalizeUsageConfig(input.usages.contextSummarizer),
    vision: normalizeUsageConfig(input.usages.vision),
    webSearchAgent: normalizeUsageConfig(input.usages.webSearchAgent),
  };
}

function normalizeUsageConfig(value: Config["server"]["llm"]["usages"]["agent"]): LlmUsageConfig {
  return {
    attempts: value.attempts.map(attempt => normalizeUsageAttempt(attempt)),
  };
}

function normalizeUsageAttempt(
  value: Config["server"]["llm"]["usages"]["agent"]["attempts"][number],
): LlmUsageAttemptConfig {
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
