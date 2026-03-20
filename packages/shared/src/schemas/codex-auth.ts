import { z } from "zod";

export const CodexAuthStatusSchema = z.enum([
  "active",
  "expired",
  "refresh_failed",
  "logged_out",
  "unavailable",
]);

export type CodexAuthStatus = z.infer<typeof CodexAuthStatusSchema>;

export const CodexAuthSessionSummarySchema = z
  .object({
    provider: z.literal("openai-codex"),
    accountId: z.string().min(1).nullable(),
    email: z.string().email().nullable(),
    expiresAt: z.string().datetime().nullable(),
    lastRefreshAt: z.string().datetime().nullable(),
    lastError: z.string().min(1).nullable(),
  })
  .strict();

export type CodexAuthSessionSummary = z.infer<typeof CodexAuthSessionSummarySchema>;

export const CodexAuthStatusResponseSchema = z
  .object({
    status: CodexAuthStatusSchema,
    isLoggedIn: z.boolean(),
    session: CodexAuthSessionSummarySchema.nullable(),
  })
  .strict();

export type CodexAuthStatusResponse = z.infer<typeof CodexAuthStatusResponseSchema>;

export const CodexAuthLoginUrlResponseSchema = z
  .object({
    loginUrl: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type CodexAuthLoginUrlResponse = z.infer<typeof CodexAuthLoginUrlResponseSchema>;

export const CodexAuthLogoutResponseSchema = z
  .object({
    success: z.literal(true),
    status: CodexAuthStatusSchema,
  })
  .strict();

export type CodexAuthLogoutResponse = z.infer<typeof CodexAuthLogoutResponseSchema>;

export const CodexAuthRefreshResponseSchema = z
  .object({
    success: z.literal(true),
    status: CodexAuthStatusSchema,
    session: CodexAuthSessionSummarySchema.nullable(),
  })
  .strict();

export type CodexAuthRefreshResponse = z.infer<typeof CodexAuthRefreshResponseSchema>;
