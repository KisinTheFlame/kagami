import { z } from "zod";
import {
  AuthLoginUrlResponseSchema,
  AuthRefreshResponseSchema,
  AuthStatusResponseSchema,
  AuthStatusSchema,
  ClaudeCodeExtraUsageSchema as BaseClaudeCodeExtraUsageSchema,
  ClaudeCodeUsageLimitWindowSchema as BaseClaudeCodeUsageLimitWindowSchema,
  ClaudeCodeUsageLimitsSchema,
  type AuthLoginUrlResponse,
  type AuthRefreshResponse,
  type AuthStatus,
  type AuthStatusResponse,
  type ClaudeCodeUsageLimits as BaseClaudeCodeUsageLimits,
} from "./auth.js";

export const ClaudeCodeAuthStatusSchema = AuthStatusSchema;

export type ClaudeCodeAuthStatus = AuthStatus;

export const ClaudeCodeAuthSessionSummarySchema = AuthStatusResponseSchema.shape.session.unwrap();

export type ClaudeCodeAuthSessionSummary = NonNullable<AuthStatusResponse["session"]>;

export const ClaudeCodeAuthStatusResponseSchema = AuthStatusResponseSchema;

export type ClaudeCodeAuthStatusResponse = AuthStatusResponse;

export const ClaudeCodeAuthLoginUrlResponseSchema = AuthLoginUrlResponseSchema;

export type ClaudeCodeAuthLoginUrlResponse = AuthLoginUrlResponse;

export const ClaudeCodeAuthLogoutResponseSchema = AuthRefreshResponseSchema.pick({
  provider: true,
  success: true,
  status: true,
});

export type ClaudeCodeAuthLogoutResponse = Omit<AuthRefreshResponse, "session">;

export const ClaudeCodeAuthRefreshResponseSchema = AuthRefreshResponseSchema;

export type ClaudeCodeAuthRefreshResponse = AuthRefreshResponse;

export const ClaudeCodeUsageLimitWindowSchema = BaseClaudeCodeUsageLimitWindowSchema;
export type ClaudeCodeUsageLimitWindow = z.infer<typeof ClaudeCodeUsageLimitWindowSchema>;

export const ClaudeCodeExtraUsageSchema = BaseClaudeCodeExtraUsageSchema;
export type ClaudeCodeExtraUsage = z.infer<typeof ClaudeCodeExtraUsageSchema>;

export const ClaudeCodeUsageLimitsResponseSchema = ClaudeCodeUsageLimitsSchema;

export type ClaudeCodeUsageLimits = BaseClaudeCodeUsageLimits;
export type ClaudeCodeUsageLimitsResponse = ClaudeCodeUsageLimits;
