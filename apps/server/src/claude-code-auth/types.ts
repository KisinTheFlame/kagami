import type {
  OAuthProviderAuth,
  OAuthSessionRecord,
  OAuthStateRecord,
  OAuthStatus,
  OAuthTokenResponse,
} from "../auth/shared/types.js";

export type ClaudeCodeAuthStatus = OAuthStatus;

export type ClaudeCodeAuthSessionRecord = OAuthSessionRecord<"claude-code">;

export type ClaudeCodeOAuthStateRecord = OAuthStateRecord;

export type ClaudeCodeProviderAuth = OAuthProviderAuth;

export type ClaudeCodeTokenResponse = OAuthTokenResponse;
