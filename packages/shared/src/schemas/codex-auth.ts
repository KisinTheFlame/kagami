import {
  AuthLoginUrlResponseSchema,
  AuthRefreshResponseSchema,
  AuthStatusResponseSchema,
  AuthStatusSchema,
  CodexUsageLimitWindowSchema,
  CodexUsageLimitsSchema,
  type AuthLoginUrlResponse,
  type AuthRefreshResponse,
  type AuthStatus,
  type AuthStatusResponse,
  type CodexUsageLimitWindow,
  type CodexUsageLimits,
} from "./auth.js";

export const CodexAuthStatusSchema = AuthStatusSchema;

export type CodexAuthStatus = AuthStatus;

export const CodexAuthSessionSummarySchema = AuthStatusResponseSchema.shape.session.unwrap();

export type CodexAuthSessionSummary = NonNullable<AuthStatusResponse["session"]>;

export const CodexAuthStatusResponseSchema = AuthStatusResponseSchema;

export type CodexAuthStatusResponse = AuthStatusResponse;

export const CodexAuthLoginUrlResponseSchema = AuthLoginUrlResponseSchema;

export type CodexAuthLoginUrlResponse = AuthLoginUrlResponse;

export const CodexAuthLogoutResponseSchema = AuthRefreshResponseSchema.pick({
  provider: true,
  success: true,
  status: true,
});

export type CodexAuthLogoutResponse = Omit<AuthRefreshResponse, "session">;

export const CodexAuthRefreshResponseSchema = AuthRefreshResponseSchema;

export type CodexAuthRefreshResponse = AuthRefreshResponse;

export { CodexUsageLimitWindowSchema };

export type { CodexUsageLimitWindow };

export const CodexUsageLimitsResponseSchema = CodexUsageLimitsSchema;

export type CodexUsageLimitsResponse = CodexUsageLimits;
