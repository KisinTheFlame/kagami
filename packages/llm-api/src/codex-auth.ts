import { z } from "zod";
import {
  AuthLoginUrlResponseSchema,
  AuthRefreshResponseSchema,
  AuthStatusResponseSchema,
  AuthStatusSchema,
  CodexUsageLimitWindowSchema as BaseCodexUsageLimitWindowSchema,
  CodexUsageLimitsSchema,
  type AuthLoginUrlResponse,
  type AuthRefreshResponse,
  type AuthStatus,
  type AuthStatusResponse,
  type CodexUsageLimits as BaseCodexUsageLimits,
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

export const CodexUsageLimitWindowSchema = BaseCodexUsageLimitWindowSchema;
export type CodexUsageLimitWindow = z.infer<typeof CodexUsageLimitWindowSchema>;

export const CodexUsageLimitsResponseSchema = CodexUsageLimitsSchema;

export type CodexUsageLimits = BaseCodexUsageLimits;
export type CodexUsageLimitsResponse = CodexUsageLimits;
