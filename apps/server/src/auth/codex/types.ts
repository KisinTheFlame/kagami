import type {
  OAuthProviderAuth,
  OAuthSessionRecord,
  OAuthStateRecord,
  OAuthStatus,
  OAuthTokenResponse,
} from "../shared/types.js";

export type CodexAuthStatus = OAuthStatus;

export type CodexAuthSessionRecord = OAuthSessionRecord<"openai-codex">;

export type CodexOAuthStateRecord = OAuthStateRecord;

export type CodexProviderAuth = OAuthProviderAuth;

export type CodexTokenResponse = OAuthTokenResponse;
