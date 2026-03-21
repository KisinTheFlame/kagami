export type ClaudeCodeAuthStatus =
  | "active"
  | "expired"
  | "refresh_failed"
  | "logged_out"
  | "unavailable";

export type ClaudeCodeAuthSessionRecord = {
  id: number;
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
  createdAt: Date;
  updatedAt: Date;
};

export type ClaudeCodeOAuthStateRecord = {
  id: number;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type ClaudeCodeProviderAuth = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  lastRefresh: string;
  expiresAt: number;
};

export type ClaudeCodeTokenResponse = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  expiresAt: Date;
  lastRefreshAt: Date;
};
