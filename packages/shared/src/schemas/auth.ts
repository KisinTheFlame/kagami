import { z } from "zod";

export const AuthProviderSchema = z.enum(["codex", "claude-code"]);

export type AuthProvider = z.infer<typeof AuthProviderSchema>;

export const AuthStatusSchema = z.enum([
  "active",
  "expired",
  "refresh_failed",
  "logged_out",
  "unavailable",
]);

export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const AuthSessionSummarySchema = z
  .object({
    provider: AuthProviderSchema,
    accountId: z.string().min(1).nullable(),
    email: z.string().email().nullable(),
    expiresAt: z.string().datetime().nullable(),
    lastRefreshAt: z.string().datetime().nullable(),
    lastError: z.string().min(1).nullable(),
  })
  .strict();

export type AuthSessionSummary = z.infer<typeof AuthSessionSummarySchema>;

export const AuthStatusResponseSchema = z
  .object({
    provider: AuthProviderSchema,
    status: AuthStatusSchema,
    isLoggedIn: z.boolean(),
    session: AuthSessionSummarySchema.nullable(),
  })
  .strict();

export type AuthStatusResponse = z.infer<typeof AuthStatusResponseSchema>;

export const AuthLoginUrlResponseSchema = z
  .object({
    provider: AuthProviderSchema,
    loginUrl: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type AuthLoginUrlResponse = z.infer<typeof AuthLoginUrlResponseSchema>;

export const AuthLogoutResponseSchema = z
  .object({
    provider: AuthProviderSchema,
    success: z.literal(true),
    status: AuthStatusSchema,
  })
  .strict();

export type AuthLogoutResponse = z.infer<typeof AuthLogoutResponseSchema>;

export const AuthRefreshResponseSchema = z
  .object({
    provider: AuthProviderSchema,
    success: z.literal(true),
    status: AuthStatusSchema,
    session: AuthSessionSummarySchema.nullable(),
  })
  .strict();

export type AuthRefreshResponse = z.infer<typeof AuthRefreshResponseSchema>;

export const CodexUsageLimitWindowSchema = z
  .object({
    usedPercent: z.number(),
    windowDurationMins: z.number().int().nonnegative(),
    resetsAt: z.number().int().nonnegative(),
  })
  .strict();

export type CodexUsageLimitWindow = z.infer<typeof CodexUsageLimitWindowSchema>;

export const CodexUsageLimitsSchema = z
  .object({
    primary: CodexUsageLimitWindowSchema.nullable(),
    secondary: CodexUsageLimitWindowSchema.nullable(),
  })
  .strict();

export type CodexUsageLimits = z.infer<typeof CodexUsageLimitsSchema>;

export const ClaudeCodeUsageLimitWindowSchema = z
  .object({
    utilization: z.number(),
    resets_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type ClaudeCodeUsageLimitWindow = z.infer<typeof ClaudeCodeUsageLimitWindowSchema>;

export const ClaudeCodeExtraUsageSchema = z
  .object({
    is_enabled: z.boolean(),
    monthly_limit: z.number().nullable(),
    used_credits: z.number().nullable(),
    utilization: z.number().nullable(),
  })
  .strict();

export type ClaudeCodeExtraUsage = z.infer<typeof ClaudeCodeExtraUsageSchema>;

export const ClaudeCodeUsageLimitsSchema = z
  .object({
    five_hour: ClaudeCodeUsageLimitWindowSchema.nullable(),
    seven_day: ClaudeCodeUsageLimitWindowSchema.nullable(),
    extra_usage: ClaudeCodeExtraUsageSchema.nullable(),
  })
  .strict();

export type ClaudeCodeUsageLimits = z.infer<typeof ClaudeCodeUsageLimitsSchema>;

export const AuthUsageLimitsResponseSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("codex"),
      limits: CodexUsageLimitsSchema,
    })
    .strict(),
  z
    .object({
      provider: z.literal("claude-code"),
      limits: ClaudeCodeUsageLimitsSchema,
    })
    .strict(),
]);

export type AuthUsageLimitsResponse = z.infer<typeof AuthUsageLimitsResponseSchema>;
