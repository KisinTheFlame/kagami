import type {
  ClaudeCodeAuthSessionRecord,
  ClaudeCodeOAuthStateRecord,
  ClaudeCodeAuthStatus,
} from "../claude-code-auth/types.js";

export type UpsertClaudeCodeAuthSessionInput = {
  provider: "claude-code";
  accountId: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
  status: Exclude<ClaudeCodeAuthStatus, "unavailable">;
  lastError: string | null;
};

export type CreateClaudeCodeOAuthStateInput = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
};

export interface ClaudeCodeAuthDao {
  findSession(provider: "claude-code"): Promise<ClaudeCodeAuthSessionRecord | null>;
  upsertSession(input: UpsertClaudeCodeAuthSessionInput): Promise<ClaudeCodeAuthSessionRecord>;
  createOAuthState(input: CreateClaudeCodeOAuthStateInput): Promise<ClaudeCodeOAuthStateRecord>;
  findOAuthState(state: string): Promise<ClaudeCodeOAuthStateRecord | null>;
  markOAuthStateUsed(state: string, usedAt: Date): Promise<void>;
  deleteExpiredOAuthStates(before: Date): Promise<void>;
}
