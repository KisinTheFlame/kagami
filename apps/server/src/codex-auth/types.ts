export type CodexAuthStatus =
  | "active"
  | "expired"
  | "refresh_failed"
  | "logged_out"
  | "unavailable";

export type CodexAuthSessionRecord = {
  id: number;
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
  createdAt: Date;
  updatedAt: Date;
};

export type CodexOAuthStateRecord = {
  id: number;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type CodexProviderAuth = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  lastRefresh: string;
  expiresAt: number;
};

export type CodexTokenResponse = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  expiresAt: Date;
  lastRefreshAt: Date;
};
