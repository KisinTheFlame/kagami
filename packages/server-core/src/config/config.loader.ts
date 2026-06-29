import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LLM_PROVIDER_IDS, type LlmProviderId } from "@kagami/llm";
import { parse } from "yaml";
import { z } from "zod";
import { BizError } from "../common/errors/biz-error.js";
import type { LlmUsageId } from "../common/contracts/llm.js";

const DEFAULT_PORT = 20003;
const DEFAULT_NAPCAT_STARTUP_CONTEXT_RECENT_MESSAGE_COUNT = 40;
const DEFAULT_AGENT_CONTEXT_COMPACTION_TOTAL_TOKEN_THRESHOLD = 150_000;
const DEFAULT_AGENT_LLM_RETRY_BACKOFF_MS = 30_000;
const DEFAULT_AGENT_WAIT_TOOL_MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_AGENT_NOTIFICATION_LEADING_WINDOW_MS = 10_000;
const DEFAULT_AGENT_NOTIFICATION_BATCH_WINDOW_MS = 30_000;
const DEFAULT_AGENT_STORY_ENABLED = true;
const DEFAULT_AGENT_STORY_BATCH_SIZE = 24;
const DEFAULT_AGENT_STORY_IDLE_FLUSH_MS = 2 * 60 * 1000;
const DEFAULT_AGENT_MESSAGING_AI_TONE_ENABLED = true;
const DEFAULT_AGENT_MESSAGING_AI_TONE_BLOCK_THRESHOLD = 0.8;
// 资源读取/发送的字节上限：read_resource 入上下文 / send_resource 发图共用。
// 4 MiB 贴合 QQ 图片实际体量，也避免把巨型资源灌进上下文或 napcat WS。
const DEFAULT_AGENT_RESOURCE_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_ITHOME_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_ITHOME_RECENT_ARTICLE_LIMIT = 8;
const DEFAULT_ITHOME_ARTICLE_MAX_CHARS = 8000;
const DEFAULT_LLM_TIMEOUT_MS = 45_000;
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";
const DEFAULT_CLAUDE_CODE_BASE_URL = "https://api.anthropic.com";
const DEFAULT_CLAUDE_CODE_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_CLAUDE_CODE_KEEP_ALIVE_REPLAY_INTERVAL_MINUTES = 30;
const DEFAULT_AUTH_USAGE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_CODEX_AUTH_ENABLED = true;
const DEFAULT_CODEX_AUTH_PUBLIC_BASE_URL = "http://localhost:20004";
const DEFAULT_CODEX_AUTH_REDIRECT_PATH = "/auth/callback";
const DEFAULT_CODEX_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_OPENAI_CODEX_REFRESH_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_CODEX_AUTH_BINARY_PATH = "codex";
const DEFAULT_CLAUDE_CODE_AUTH_ENABLED = true;
const DEFAULT_CLAUDE_CODE_AUTH_PUBLIC_BASE_URL = "http://localhost:20004";
const DEFAULT_CLAUDE_CODE_AUTH_REDIRECT_PATH = "/callback";
const DEFAULT_CLAUDE_CODE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLAUDE_CODE_REFRESH_LEEWAY_MS = 7_200_000;
const DEFAULT_CLAUDE_CODE_REFRESH_CHECK_INTERVAL_MS = 300_000;
const DEFAULT_GEMINI_EMBEDDING_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY = 768;
const DEFAULT_STORY_MEMORY_RETRIEVAL_TOP_K = 3;
const DEFAULT_STORY_MEMORY_VECTOR_INDEX_PATH = "./data/vector/story-memory.hnsw";
const DEFAULT_STORY_RECALL_TOP_K = 2;
const DEFAULT_STORY_RECALL_SCORE_THRESHOLD = 0.65;
const DEFAULT_STORY_RECALL_ENABLED = true;
const DEFAULT_AGENT_ASYNC_TASK_MAX_DURATION_MS = 10 * 60 * 1000;

const UrlSchema = z.string().url();
/**
 * `databaseUrl` 现为 SQLite 文件路径（`file:./data/sqlite/kagami.db`），不再是网络 URL，
 * 因此只校验非空字符串；绝对路径解析在 {@link loadStaticConfig} 中完成。
 */
const DatabaseUrlSchema = z.string().trim().min(1);
const FilePathSchema = z.string().trim().min(1);
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
const LlmProviderSchema = z.enum(LLM_PROVIDER_IDS);
const GoogleStoryMemoryEmbeddingConfigSchema = z.object({
  provider: z.literal("google"),
  apiKey: NonEmptyStringSchema,
  baseUrl: UrlSchema.default(DEFAULT_GEMINI_EMBEDDING_BASE_URL),
  model: NonEmptyStringSchema.default(DEFAULT_GEMINI_EMBEDDING_MODEL),
  outputDimensionality: PositiveIntSchema.default(DEFAULT_GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY),
});
const TeiEmbeddingGemmaConfigSchema = z.object({
  provider: z.literal("tei-embedding-gemma"),
  baseUrl: UrlSchema,
  model: NonEmptyStringSchema,
  outputDimensionality: PositiveIntSchema,
});
const StoryMemoryEmbeddingConfigSchema = z.preprocess(
  value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    if ("provider" in record) {
      return value;
    }

    return {
      ...record,
      provider: "google",
    };
  },
  z.discriminatedUnion("provider", [
    GoogleStoryMemoryEmbeddingConfigSchema,
    TeiEmbeddingGemmaConfigSchema,
  ]),
);
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
    databaseUrl: DatabaseUrlSchema,
    port: PositiveIntSchema.default(DEFAULT_PORT),
    agent: z.preprocess(
      value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return value;
        }

        const record = value as Record<string, unknown>;
        if (!("contextCompactionThreshold" in record)) {
          return value;
        }

        return {
          ...record,
          __legacyContextCompactionThreshold__: record.contextCompactionThreshold,
        };
      },
      z
        .object({
          contextCompactionTotalTokenThreshold: PositiveIntSchema.default(
            DEFAULT_AGENT_CONTEXT_COMPACTION_TOTAL_TOKEN_THRESHOLD,
          ),
          llmRetryBackoffMs: PositiveIntSchema.default(DEFAULT_AGENT_LLM_RETRY_BACKOFF_MS),
          waitToolMaxWaitMs: PositiveIntSchema.default(DEFAULT_AGENT_WAIT_TOOL_MAX_WAIT_MS),
          notificationLeadingWindowMs: PositiveIntSchema.default(
            DEFAULT_AGENT_NOTIFICATION_LEADING_WINDOW_MS,
          ),
          notificationBatchWindowMs: PositiveIntSchema.default(
            DEFAULT_AGENT_NOTIFICATION_BATCH_WINDOW_MS,
          ),
          story: z.object({
            enabled: z.boolean().default(DEFAULT_AGENT_STORY_ENABLED),
            batchSize: PositiveIntSchema.default(DEFAULT_AGENT_STORY_BATCH_SIZE),
            idleFlushMs: PositiveIntSchema.default(DEFAULT_AGENT_STORY_IDLE_FLUSH_MS),
            memory: z.object({
              embedding: StoryMemoryEmbeddingConfigSchema,
              vectorIndexPath: FilePathSchema.default(DEFAULT_STORY_MEMORY_VECTOR_INDEX_PATH),
              retrieval: z
                .object({
                  topK: PositiveIntSchema.default(DEFAULT_STORY_MEMORY_RETRIEVAL_TOP_K),
                })
                .default({}),
            }),
            recall: z
              .object({
                enabled: z.boolean().default(DEFAULT_STORY_RECALL_ENABLED),
                topK: PositiveIntSchema.default(DEFAULT_STORY_RECALL_TOP_K),
                scoreThreshold: z
                  .number()
                  .min(0)
                  .max(1)
                  .default(DEFAULT_STORY_RECALL_SCORE_THRESHOLD),
              })
              .default({}),
          }),
          messaging: z
            .object({
              aiTone: z
                .object({
                  enabled: z.boolean().default(DEFAULT_AGENT_MESSAGING_AI_TONE_ENABLED),
                  blockThreshold: z
                    .number()
                    .min(0)
                    .max(1)
                    .default(DEFAULT_AGENT_MESSAGING_AI_TONE_BLOCK_THRESHOLD),
                })
                .default({}),
            })
            .default({}),
          asyncTask: z
            .object({
              maxTaskDurationMs: PositiveIntSchema.default(
                DEFAULT_AGENT_ASYNC_TASK_MAX_DURATION_MS,
              ),
            })
            .default({}),
          resource: z
            .object({
              maxBytes: PositiveIntSchema.default(DEFAULT_AGENT_RESOURCE_MAX_BYTES),
            })
            .default({}),
          __legacyContextCompactionThreshold__: z.unknown().optional(),
        })
        .superRefine((value, ctx) => {
          if (value.__legacyContextCompactionThreshold__ !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["contextCompactionThreshold"],
              message:
                "contextCompactionThreshold 已废弃，请改用 contextCompactionTotalTokenThreshold",
            });
          }
        })
        .transform(value => ({
          contextCompactionTotalTokenThreshold: value.contextCompactionTotalTokenThreshold,
          llmRetryBackoffMs: value.llmRetryBackoffMs,
          waitToolMaxWaitMs: value.waitToolMaxWaitMs,
          notificationLeadingWindowMs: value.notificationLeadingWindowMs,
          notificationBatchWindowMs: value.notificationBatchWindowMs,
          story: value.story,
          messaging: value.messaging,
          asyncTask: value.asyncTask,
          resource: value.resource,
        })),
    ),
    ithome: z
      .object({
        pollIntervalMs: PositiveIntSchema.default(DEFAULT_ITHOME_POLL_INTERVAL_MS),
        recentArticleLimit: PositiveIntSchema.default(DEFAULT_ITHOME_RECENT_ARTICLE_LIMIT),
        articleMaxChars: PositiveIntSchema.default(DEFAULT_ITHOME_ARTICLE_MAX_CHARS),
      })
      .default({}),
    napcat: NapcatConfigSchema,
    llm: z.object({
      timeoutMs: PositiveIntSchema.default(DEFAULT_LLM_TIMEOUT_MS),
      authUsageRefreshIntervalMs: PositiveIntSchema.default(DEFAULT_AUTH_USAGE_REFRESH_INTERVAL_MS),
      codexAuth: z
        .object({
          enabled: z.boolean().default(DEFAULT_CODEX_AUTH_ENABLED),
          publicBaseUrl: UrlSchema.default(DEFAULT_CODEX_AUTH_PUBLIC_BASE_URL),
          oauthRedirectPath: z.string().trim().min(1).default(DEFAULT_CODEX_AUTH_REDIRECT_PATH),
          oauthStateTtlMs: PositiveIntSchema.default(DEFAULT_CODEX_AUTH_STATE_TTL_MS),
          refreshLeewayMs: PositiveIntSchema.default(DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS),
          refreshCheckIntervalMs: PositiveIntSchema.default(
            DEFAULT_OPENAI_CODEX_REFRESH_CHECK_INTERVAL_MS,
          ),
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
          storyAgent: LlmUsageConfigSchema.optional(),
          contextSummarizer: LlmUsageConfigSchema,
          vision: LlmUsageConfigSchema,
          webSearchAgent: LlmUsageConfigSchema,
        })
        .strict(),
    }),
    tavily: z.object({
      apiKey: NonEmptyStringSchema,
    }),
    bot: z.object({
      qq: StringLikeSchema,
      creator: z.object({
        name: NonEmptyStringSchema,
        qq: StringLikeSchema,
      }),
    }),
    /**
     * 自建对象存储（@kagami/oss）的访问地址，给 server 把 QQ 图片原图 PUT 进去用。
     * 可选：缺失即关闭图片存档（resid 恒为 null，只走 vision 文字描述，优雅降级）。
     */
    oss: z
      .object({
        baseUrl: UrlSchema,
      })
      .strict()
      .optional(),
    /**
     * 每个 App 的配置切片，key 是 App.id。结构由各 App 自己的 configSchema 在
     * AppManager.startupAll 阶段校验，loader 这一层不解读。
     */
    apps: z.record(z.string(), z.unknown()).default({}),
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

type RawConfig = z.infer<typeof ConfigSchema>;

export type Config = Omit<RawConfig, "server"> & {
  server: Omit<RawConfig["server"], "llm"> & {
    llm: Omit<RawConfig["server"]["llm"], "usages"> & {
      usages: Record<LlmUsageId, LlmUsageConfig>;
    };
  };
};

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

  const configDir = path.dirname(configPath);
  const data = parsedConfig.data;
  const memory = data.server.agent.story.memory;

  return {
    ...data,
    server: {
      ...data.server,
      databaseUrl: resolveSqliteFileUrl(configDir, data.server.databaseUrl),
      agent: {
        ...data.server.agent,
        story: {
          ...data.server.agent.story,
          memory: {
            ...memory,
            vectorIndexPath: resolveAbsolutePath(configDir, memory.vectorIndexPath),
          },
        },
      },
      llm: {
        ...data.server.llm,
        usages: normalizeLlmUsages(data.server.llm),
      },
    },
  };
}

function stripFileScheme(value: string): string {
  return value.startsWith("file:") ? value.slice("file:".length) : value;
}

function resolveAbsolutePath(baseDir: string, value: string): string {
  const raw = stripFileScheme(value);
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
}

/**
 * 将 config 中相对仓库根的 SQLite 路径解析为绝对 `file:` URL，运行时与 Prisma CLI
 * 共用同一锚点（config.yaml 所在目录），避免在不同 cwd 下建出两个库。只处理 `file:`
 * 路径；`file::memory:`、`:memory:` 及其它 scheme（历史 postgresql:// 等）原样返回。
 */
function resolveSqliteFileUrl(baseDir: string, value: string): string {
  if (!value.startsWith("file:") || value === "file::memory:") {
    return value;
  }

  return `file:${resolveAbsolutePath(baseDir, value)}`;
}

function normalizeLlmUsages(input: RawConfig["server"]["llm"]): Record<LlmUsageId, LlmUsageConfig> {
  return {
    agent: normalizeUsageConfig(input.usages.agent),
    storyAgent: normalizeUsageConfig(input.usages.storyAgent ?? input.usages.agent),
    contextSummarizer: normalizeUsageConfig(input.usages.contextSummarizer),
    vision: normalizeUsageConfig(input.usages.vision),
    webSearchAgent: normalizeUsageConfig(input.usages.webSearchAgent),
  };
}

function normalizeUsageConfig(
  value: RawConfig["server"]["llm"]["usages"]["agent"],
): LlmUsageConfig {
  return {
    attempts: value.attempts.map(attempt => normalizeUsageAttempt(attempt)),
  };
}

function normalizeUsageAttempt(
  value: RawConfig["server"]["llm"]["usages"]["agent"]["attempts"][number],
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

  const worktreeSearchRoots = [
    process.cwd(),
    fileURLToPath(new URL("../../../..", import.meta.url)),
  ];
  for (const root of worktreeSearchRoots) {
    const mainRoot = findGitWorktreeMainRoot(root);
    if (mainRoot) {
      const candidate = path.join(mainRoot, "config.yaml");
      if (existsSync(candidate)) {
        return candidate;
      }
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

function findGitWorktreeMainRoot(repoRoot: string): string | null {
  const dotGit = path.join(repoRoot, ".git");
  if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return null;

  const content = readFileSync(dotGit, "utf8");
  const match = content.match(/^gitdir:\s*(.+)$/m);
  if (!match) return null;

  const gitDir = path.resolve(repoRoot, match[1].trim());
  const commondirFile = path.join(gitDir, "commondir");
  if (!existsSync(commondirFile)) return null;

  const commondirContent = readFileSync(commondirFile, "utf8").trim();
  return path.dirname(path.resolve(gitDir, commondirContent));
}
