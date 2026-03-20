import type {
  CodexAuthSessionRecord,
  CodexOAuthStateRecord,
  CodexAuthStatus,
} from "../codex-auth/types.js";

export type UpsertCodexAuthSessionInput = {
  provider: "openai-codex";
  accountId: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
  status: Exclude<CodexAuthStatus, "unavailable">;
  lastError: string | null;
};

export type CreateCodexOAuthStateInput = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
};

export interface CodexAuthDao {
  findSession(provider: "openai-codex"): Promise<CodexAuthSessionRecord | null>;
  upsertSession(input: UpsertCodexAuthSessionInput): Promise<CodexAuthSessionRecord>;
  createOAuthState(input: CreateCodexOAuthStateInput): Promise<CodexOAuthStateRecord>;
  findOAuthState(state: string): Promise<CodexOAuthStateRecord | null>;
  markOAuthStateUsed(state: string, usedAt: Date): Promise<void>;
  deleteExpiredOAuthStates(before: Date): Promise<void>;
}
