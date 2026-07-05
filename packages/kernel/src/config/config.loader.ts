import path from "node:path";
import { ConfigError } from "@kagami/config/errors";
import { loadMergedRawConfig } from "@kagami/config/source";
import { LLM_PROVIDER_IDS, type LlmProviderId } from "@kagami/llm";
import { z } from "zod";
import type { LlmUsageId } from "../contracts/llm.js";

const DEFAULT_NAPCAT_STARTUP_CONTEXT_RECENT_MESSAGE_COUNT = 40;
const DEFAULT_AGENT_CONTEXT_COMPACTION_TOTAL_TOKEN_THRESHOLD = 150_000;
const DEFAULT_AGENT_LLM_RETRY_BACKOFF_MS = 30_000;
const DEFAULT_AGENT_WAIT_TOOL_MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_AGENT_NOTIFICATION_LEADING_WINDOW_MS = 10_000;
const DEFAULT_AGENT_NOTIFICATION_BATCH_WINDOW_MS = 30_000;
const DEFAULT_AGENT_MESSAGING_AI_TONE_ENABLED = true;
const DEFAULT_AGENT_MESSAGING_AI_TONE_BLOCK_THRESHOLD = 0.6;
// 资源读取/发送的字节上限：read_resource 入上下文 / send_resource 发图共用。
// 4 MiB 贴合 QQ 图片实际体量，也避免把巨型资源灌进上下文或 napcat WS。
const DEFAULT_AGENT_RESOURCE_MAX_BYTES = 4 * 1024 * 1024;
// 文件桥（download_resource / upload_resource / 群文件）落盘 / 读盘 / 传输的沙箱根与字节上限。
// fileRoot 默认 ~/kagami，与 terminal initialCwd 默认值重合，落盘后 terminal ls 天然可见。
// fileMaxBytes 32 MiB 独立于上下文 cap（4 MiB）——文件不进上下文，可更大，但压在 OSS 50MB 请求上限下。
const DEFAULT_AGENT_RESOURCE_FILE_ROOT = "~/kagami";
const DEFAULT_AGENT_RESOURCE_FILE_MAX_BYTES = 32 * 1024 * 1024;
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
const DEFAULT_CODEX_AUTH_REDIRECT_PATH = "/auth/callback";
const DEFAULT_CODEX_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_OPENAI_CODEX_REFRESH_LEEWAY_MS = 60_000;
const DEFAULT_OPENAI_CODEX_REFRESH_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_CODEX_AUTH_BINARY_PATH = "codex";
const DEFAULT_CLAUDE_CODE_AUTH_ENABLED = true;
const DEFAULT_CLAUDE_CODE_AUTH_REDIRECT_PATH = "/callback";
const DEFAULT_CLAUDE_CODE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CLAUDE_CODE_REFRESH_LEEWAY_MS = 7_200_000;
const DEFAULT_CLAUDE_CODE_REFRESH_CHECK_INTERVAL_MS = 300_000;
const DEFAULT_GEMINI_EMBEDDING_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_GEMINI_EMBEDDING_OUTPUT_DIMENSIONALITY = 768;
const DEFAULT_AGENT_ASYNC_TASK_MAX_DURATION_MS = 10 * 60 * 1000;

const UrlSchema = z.string().url();
/**
 * `databaseUrl` 现为 SQLite 文件路径（`file:./data/sqlite/kagami.db`），不再是网络 URL，
 * 因此只校验非空字符串；绝对路径解析在 {@link loadStaticConfig} 中完成。
 */
const DatabaseUrlSchema = z.string().trim().min(1);
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
const GoogleEmbeddingConfigSchema = z.object({
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
const EmbeddingConfigSchema = z.preprocess(
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
  z.discriminatedUnion("provider", [GoogleEmbeddingConfigSchema, TeiEmbeddingGemmaConfigSchema]),
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

/**
 * 单机服务拓扑的唯一事实来源。每个进程从这里读自己的监听端口与依赖服务的地址；
 * `host` 语义是「别的服务/网关如何 reach 它」（reachable host），不是绑定地址（issue #162）。
 * 绑定地址是各服务代码里的安全决策：卫星进程一律绑 127.0.0.1（runService 的 bindHost），
 * 只有 gateway（前门）绑 0.0.0.0。
 */
const ServiceEndpointSchema = z
  .object({
    host: NonEmptyStringSchema,
    port: PositiveIntSchema,
  })
  .strict();
const ServicesSchema = z
  .object({
    agent: ServiceEndpointSchema,
    console: ServiceEndpointSchema,
    gateway: ServiceEndpointSchema,
    oss: ServiceEndpointSchema,
    browser: ServiceEndpointSchema,
    llm: ServiceEndpointSchema,
    metric: ServiceEndpointSchema,
    spire: ServiceEndpointSchema,
    napcat: ServiceEndpointSchema,
    pixel: ServiceEndpointSchema,
    scheduler: ServiceEndpointSchema,
  })
  .strict();

const ConfigSchema = z.object({
  services: ServicesSchema,
  server: z.object({
    databaseUrl: DatabaseUrlSchema,
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
              fileRoot: NonEmptyStringSchema.default(DEFAULT_AGENT_RESOURCE_FILE_ROOT),
              fileMaxBytes: PositiveIntSchema.default(DEFAULT_AGENT_RESOURCE_FILE_MAX_BYTES),
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
      // 文本向量化配置：LLM 网关（apps/llm）持有 embedding client，agent 经 HTTP 调用。
      // 与任何具体上层能力（记忆等）解耦，是网关的通用能力配置。
      embedding: EmbeddingConfigSchema,
      codexAuth: z
        .object({
          enabled: z.boolean().default(DEFAULT_CODEX_AUTH_ENABLED),
          // 缺省时在 loadStaticConfig 里派生为 http://localhost:${services.gateway.port}
          // （host 固定 localhost：浏览器回调 origin 不等于 reachable host）。可显式覆盖。
          publicBaseUrl: UrlSchema.optional(),
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
          // 同 codexAuth：缺省派生 http://localhost:${services.gateway.port}，可显式覆盖。
          publicBaseUrl: UrlSchema.optional(),
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
            // 图片走 Anthropic Files API（上传拿 file_id，请求体不再随 base64 膨胀撞 ~32MB 上限）。
            // 关掉即回退全 base64（rollback 无需回滚代码）。依赖 OAuth scope 含 user:file_upload。
            useFileApi: z.boolean().default(true),
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
          todoSuggestionAgent: LlmUsageConfigSchema,
          innerVoice: LlmUsageConfigSchema,
        })
        .strict(),
    }),
    bot: z.object({
      qq: StringLikeSchema,
      creator: z.object({
        name: NonEmptyStringSchema,
        qq: StringLikeSchema,
      }),
    }),
    /**
     * 自建对象存储（@kagami/oss）的启用开关。地址不在这里——统一来自顶层 `services.oss`，
     * agent 把 QQ 图片原图 PUT 进去用。整段可省略（=禁用，resid 恒为 null，只走 vision
     * 文字描述，优雅降级）；写出该块即启用，`enabled: false` 可显式关闭。
     */
    oss: z
      .object({
        enabled: z.boolean().default(true),
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
type RawServerLlm = RawConfig["server"]["llm"];

export type Config = Omit<RawConfig, "server"> & {
  server: Omit<RawConfig["server"], "llm"> & {
    llm: Omit<RawServerLlm, "usages" | "codexAuth" | "claudeCodeAuth"> & {
      usages: Record<LlmUsageId, LlmUsageConfig>;
      // publicBaseUrl 在 loader 里派生填充，对外恒为 string。
      codexAuth: Omit<RawServerLlm["codexAuth"], "publicBaseUrl"> & { publicBaseUrl: string };
      claudeCodeAuth: Omit<RawServerLlm["claudeCodeAuth"], "publicBaseUrl"> & {
        publicBaseUrl: string;
      };
    };
  };
};

type LoadStaticConfigOptions = {
  configPath?: string;
};

export async function loadStaticConfig(options: LoadStaticConfigOptions = {}): Promise<Config> {
  const { configPath, raw } = await loadMergedRawConfig({
    configPath: options.configPath,
    anchorUrl: import.meta.url,
    // secret（config.secret.yaml）可覆盖任意字段——单人项目，不再维护隐私路径白名单。
    // 凭据仍只放 gitignored 的 config.secret.yaml；原型污染由 @kagami/config 的深合并兜底。
    secret: { required: true },
  });

  const parsedConfig = ConfigSchema.safeParse(raw);
  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0];
    const key = issue?.path.length ? issue.path.join(".") : configPath;
    throw new ConfigError({
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
  // OAuth 回调 origin 默认派生自 services.gateway 端口，host 固定 localhost（不取
  // services.gateway.host：reachable host ≠ 浏览器可访问的 public origin）；可被显式覆盖。
  const defaultPublicBaseUrl = `http://localhost:${data.services.gateway.port}`;

  return {
    ...data,
    server: {
      ...data.server,
      databaseUrl: resolveSqliteFileUrl(configDir, data.server.databaseUrl),
      llm: {
        ...data.server.llm,
        usages: normalizeLlmUsages(data.server.llm),
        codexAuth: {
          ...data.server.llm.codexAuth,
          publicBaseUrl: data.server.llm.codexAuth.publicBaseUrl ?? defaultPublicBaseUrl,
        },
        claudeCodeAuth: {
          ...data.server.llm.claudeCodeAuth,
          publicBaseUrl: data.server.llm.claudeCodeAuth.publicBaseUrl ?? defaultPublicBaseUrl,
        },
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
    contextSummarizer: normalizeUsageConfig(input.usages.contextSummarizer),
    vision: normalizeUsageConfig(input.usages.vision),
    todoSuggestionAgent: normalizeUsageConfig(input.usages.todoSuggestionAgent),
    innerVoice: normalizeUsageConfig(input.usages.innerVoice),
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
