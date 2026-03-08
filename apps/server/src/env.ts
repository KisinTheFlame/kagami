import { existsSync } from "node:fs";
import { z } from "zod";

loadLocalEnvFile();

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }
  return value;
};

const parseNumberEnv = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
};

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.preprocess(parseNumberEnv, z.number().int().positive()).default(3000),
    DATABASE_URL: z.string().url(),
    LLM_ACTIVE_PROVIDER: z.enum(["deepseek", "openai"]).default("deepseek"),
    LLM_TIMEOUT_MS: z.preprocess(parseNumberEnv, z.number().int().positive()).default(45000),
    DEEPSEEK_API_KEY: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
    DEEPSEEK_BASE_URL: z.preprocess(
      emptyStringToUndefined,
      z.string().url().default("https://api.deepseek.com"),
    ),
    DEEPSEEK_CHAT_MODEL: z.preprocess(emptyStringToUndefined, z.string().default("deepseek-chat")),
    OPENAI_API_KEY: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
    OPENAI_BASE_URL: z.preprocess(
      emptyStringToUndefined,
      z.string().url().default("https://api.openai.com/v1"),
    ),
    OPENAI_CHAT_MODEL: z.preprocess(emptyStringToUndefined, z.string().default("gpt-4o-mini")),
    TAVILY_API_KEY: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
    NAPCAT_WS_URL: z.preprocess(emptyStringToUndefined, z.string().url()),
    NAPCAT_WS_RECONNECT_MS: z.preprocess(parseNumberEnv, z.number().int().positive()),
    NAPCAT_WS_REQUEST_TIMEOUT_MS: z.preprocess(parseNumberEnv, z.number().int().positive()),
    NAPCAT_LISTEN_GROUP_ID: z.preprocess(emptyStringToUndefined, z.string().min(1)),
    BOT_QQ: z.preprocess(emptyStringToUndefined, z.string().min(1)),
  })
  .superRefine((value, ctx) => {
    if (value.LLM_ACTIVE_PROVIDER === "deepseek" && !value.DEEPSEEK_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEEPSEEK_API_KEY"],
        message: "DEEPSEEK_API_KEY is required when LLM_ACTIVE_PROVIDER=deepseek",
      });
    }

    if (value.LLM_ACTIVE_PROVIDER === "openai" && !value.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when LLM_ACTIVE_PROVIDER=openai",
      });
    }
  });

export const env = EnvSchema.parse(process.env);

function loadLocalEnvFile(): void {
  const envFileUrl = new URL("../../../.env", import.meta.url);

  if (!existsSync(envFileUrl)) {
    return;
  }

  process.loadEnvFile(envFileUrl.pathname);
}
