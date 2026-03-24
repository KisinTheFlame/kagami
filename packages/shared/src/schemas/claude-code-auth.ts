import { z } from "zod";

export const ClaudeCodeAuthStatusSchema = z.enum([
  "active",
  "expired",
  "refresh_failed",
  "logged_out",
  "unavailable",
]);

export type ClaudeCodeAuthStatus = z.infer<typeof ClaudeCodeAuthStatusSchema>;

export const ClaudeCodeAuthSessionSummarySchema = z
  .object({
    provider: z.literal("claude-code"),
    accountId: z.string().min(1).nullable(),
    email: z.string().email().nullable(),
    expiresAt: z.string().datetime().nullable(),
    lastRefreshAt: z.string().datetime().nullable(),
    lastError: z.string().min(1).nullable(),
  })
  .strict();

export type ClaudeCodeAuthSessionSummary = z.infer<typeof ClaudeCodeAuthSessionSummarySchema>;

export const ClaudeCodeAuthStatusResponseSchema = z
  .object({
    status: ClaudeCodeAuthStatusSchema,
    isLoggedIn: z.boolean(),
    session: ClaudeCodeAuthSessionSummarySchema.nullable(),
  })
  .strict();

export type ClaudeCodeAuthStatusResponse = z.infer<typeof ClaudeCodeAuthStatusResponseSchema>;

export const ClaudeCodeAuthLoginUrlResponseSchema = z
  .object({
    loginUrl: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type ClaudeCodeAuthLoginUrlResponse = z.infer<typeof ClaudeCodeAuthLoginUrlResponseSchema>;

export const ClaudeCodeAuthLogoutResponseSchema = z
  .object({
    success: z.literal(true),
    status: ClaudeCodeAuthStatusSchema,
  })
  .strict();

export type ClaudeCodeAuthLogoutResponse = z.infer<typeof ClaudeCodeAuthLogoutResponseSchema>;

export const ClaudeCodeAuthRefreshResponseSchema = z
  .object({
    success: z.literal(true),
    status: ClaudeCodeAuthStatusSchema,
    session: ClaudeCodeAuthSessionSummarySchema.nullable(),
  })
  .strict();

export type ClaudeCodeAuthRefreshResponse = z.infer<typeof ClaudeCodeAuthRefreshResponseSchema>;

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

export const ClaudeCodeUsageLimitsResponseSchema = z
  .object({
    five_hour: ClaudeCodeUsageLimitWindowSchema.nullable(),
    seven_day: ClaudeCodeUsageLimitWindowSchema.nullable(),
    extra_usage: ClaudeCodeExtraUsageSchema.nullable(),
  })
  .strict();

export type ClaudeCodeUsageLimitsResponse = z.infer<typeof ClaudeCodeUsageLimitsResponseSchema>;
