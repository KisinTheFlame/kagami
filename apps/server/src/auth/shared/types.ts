export type OAuthStatus = "active" | "expired" | "refresh_failed" | "logged_out" | "unavailable";

export type OAuthSessionRecord<TProvider extends string> = {
  id: number;
  provider: TProvider;
  accountId: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
  status: Exclude<OAuthStatus, "unavailable">;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OAuthStateRecord = {
  id: number;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type OAuthProviderAuth = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  lastRefresh: string;
  expiresAt: number;
};

export type OAuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  expiresAt: Date;
  lastRefreshAt: Date;
};

export type OAuthRuntimeConfig = {
  enabled: boolean;
  publicBaseUrl: string;
  oauthRedirectPath: string;
  oauthStateTtlMs: number;
  refreshLeewayMs: number;
  timeoutMs: number;
};

export type OAuthCallbackInput = {
  code: string;
  state: string;
};

export type OAuthCallbackResult = {
  redirectUrl: string;
};

export type OAuthLoginUrlResponse = {
  loginUrl: string;
  expiresAt: string;
};

export type OAuthLogoutResponse = {
  success: true;
  status: Exclude<OAuthStatus, "unavailable">;
};

export type UpsertOAuthSessionInput<TProvider extends string> = {
  provider: TProvider;
  accountId: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
  status: Exclude<OAuthStatus, "unavailable">;
  lastError: string | null;
};

export type CreateOAuthStateInput = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
};

export interface OAuthDao<
  TProvider extends string,
  TSession extends OAuthSessionRecord<TProvider>,
  TState extends OAuthStateRecord = OAuthStateRecord,
> {
  findSession(provider: TProvider): Promise<TSession | null>;
  upsertSession(input: UpsertOAuthSessionInput<TProvider>): Promise<TSession>;
  createOAuthState(input: CreateOAuthStateInput): Promise<TState>;
  findOAuthState(state: string): Promise<TState | null>;
  markOAuthStateUsed(state: string, usedAt: Date): Promise<void>;
  deleteExpiredOAuthStates(before: Date): Promise<void>;
}

export interface OAuthSecretStore {
  encode(value: string): Promise<string>;
  decode(value: string): Promise<string>;
}

export interface OAuthCallbackHandler {
  handleCallback(input: OAuthCallbackInput): Promise<OAuthCallbackResult>;
}

export interface OAuthCallbackServerLike {
  beginAuthorizationWindow(ttlMs: number): Promise<void>;
  stop(): Promise<void>;
}
