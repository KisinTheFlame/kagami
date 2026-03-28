import {
  AuthLoginUrlResponseSchema,
  AuthRefreshResponseSchema,
  AuthStatusResponseSchema,
  AuthStatusSchema,
  ClaudeCodeExtraUsageSchema,
  ClaudeCodeUsageLimitWindowSchema,
  ClaudeCodeUsageLimitsSchema,
  type AuthLoginUrlResponse,
  type AuthRefreshResponse,
  type AuthStatus,
  type AuthStatusResponse,
  type ClaudeCodeExtraUsage,
  type ClaudeCodeUsageLimitWindow,
  type ClaudeCodeUsageLimits,
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

export { ClaudeCodeUsageLimitWindowSchema };

export type { ClaudeCodeUsageLimitWindow };

export { ClaudeCodeExtraUsageSchema };

export type { ClaudeCodeExtraUsage };

export const ClaudeCodeUsageLimitsResponseSchema = ClaudeCodeUsageLimitsSchema;

export type ClaudeCodeUsageLimitsResponse = ClaudeCodeUsageLimits;
