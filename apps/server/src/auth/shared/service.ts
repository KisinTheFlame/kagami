import { BizError } from "../../errors/biz-error.js";
import { createPkcePair } from "./pkce.js";
import type {
  OAuthCallbackInput,
  OAuthCallbackResult,
  OAuthCallbackServerLike,
  OAuthDao,
  OAuthLoginUrlResponse,
  OAuthLogoutResponse,
  OAuthProviderAuth,
  OAuthRuntimeConfig,
  OAuthSecretStore,
  OAuthSessionRecord,
  OAuthStateRecord,
  OAuthStatus,
  OAuthTokenResponse,
} from "./types.js";

type OAuthProtocolAdapter<TTokenResponse extends OAuthTokenResponse> = {
  buildAuthorizeUrl(input: { redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCodeForTokens(input: {
    code: string;
    state: string;
    codeVerifier: string;
    redirectUri: string;
    config: OAuthRuntimeConfig;
  }): Promise<TTokenResponse>;
  refreshTokens(input: {
    refreshToken: string;
    config: OAuthRuntimeConfig;
  }): Promise<TTokenResponse>;
  getRedirectUri(oauthRedirectPath: string): string;
};

type SharedOAuthServiceCoreDeps<
  TProvider extends string,
  TSession extends OAuthSessionRecord<TProvider>,
  TState extends OAuthStateRecord,
  TStatusResponse,
  TRefreshResponse,
  TProviderAuth extends OAuthProviderAuth,
  TTokenResponse extends OAuthTokenResponse,
> = {
  dao: OAuthDao<TProvider, TSession, TState>;
  config: OAuthRuntimeConfig;
  callbackServer: OAuthCallbackServerLike;
  secretStore: OAuthSecretStore;
  providerId: TProvider;
  displayName: string;
  managementPath: string;
  protocolAdapter: OAuthProtocolAdapter<TTokenResponse>;
  toStatusResponse(session: TSession | null): TStatusResponse;
  toRefreshResponse(session: TSession): TRefreshResponse;
  toProviderAuth(input: {
    session: TSession;
    accessToken: string;
    refreshToken: string;
    idToken: string | null;
  }): TProviderAuth;
};

export class SharedOAuthServiceCore<
  TProvider extends string,
  TSession extends OAuthSessionRecord<TProvider>,
  TState extends OAuthStateRecord,
  TStatusResponse,
  TRefreshResponse,
  TProviderAuth extends OAuthProviderAuth,
  TTokenResponse extends OAuthTokenResponse,
> {
  private readonly dao: OAuthDao<TProvider, TSession, TState>;
  private readonly config: OAuthRuntimeConfig;
  private readonly callbackServer: OAuthCallbackServerLike;
  private readonly secretStore: OAuthSecretStore;
  private readonly providerId: TProvider;
  private readonly displayName: string;
  private readonly managementPath: string;
  private readonly protocolAdapter: OAuthProtocolAdapter<TTokenResponse>;
  private readonly statusResponseMapper: (session: TSession | null) => TStatusResponse;
  private readonly refreshResponseMapper: (session: TSession) => TRefreshResponse;
  private readonly providerAuthMapper: (input: {
    session: TSession;
    accessToken: string;
    refreshToken: string;
    idToken: string | null;
  }) => TProviderAuth;
  private refreshPromise: Promise<TProviderAuth> | null = null;

  public constructor({
    dao,
    config,
    callbackServer,
    secretStore,
    providerId,
    displayName,
    managementPath,
    protocolAdapter,
    toStatusResponse,
    toRefreshResponse,
    toProviderAuth,
  }: SharedOAuthServiceCoreDeps<
    TProvider,
    TSession,
    TState,
    TStatusResponse,
    TRefreshResponse,
    TProviderAuth,
    TTokenResponse
  >) {
    this.dao = dao;
    this.config = config;
    this.callbackServer = callbackServer;
    this.secretStore = secretStore;
    this.providerId = providerId;
    this.displayName = displayName;
    this.managementPath = managementPath;
    this.protocolAdapter = protocolAdapter;
    this.statusResponseMapper = toStatusResponse;
    this.refreshResponseMapper = toRefreshResponse;
    this.providerAuthMapper = toProviderAuth;
  }

  public async getStatus(): Promise<TStatusResponse> {
    const session = await this.loadSession();
    return this.statusResponseMapper(session);
  }

  public async createLoginUrl(): Promise<OAuthLoginUrlResponse> {
    this.assertEnabled();
    await this.callbackServer.beginAuthorizationWindow(this.config.oauthStateTtlMs);

    try {
      await this.dao.deleteExpiredOAuthStates(new Date());

      const pkce = createPkcePair();
      const redirectUri = this.protocolAdapter.getRedirectUri(this.config.oauthRedirectPath);
      const expiresAt = new Date(Date.now() + this.config.oauthStateTtlMs);
      await this.dao.createOAuthState({
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        expiresAt,
      });

      return {
        loginUrl: this.protocolAdapter.buildAuthorizeUrl({
          redirectUri,
          state: pkce.state,
          codeChallenge: pkce.codeChallenge,
        }),
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      await this.callbackServer.stop().catch(() => {});
      throw error;
    }
  }

  public async handleCallback(input: OAuthCallbackInput): Promise<OAuthCallbackResult> {
    this.assertEnabled();
    const oauthState = await this.dao.findOAuthState(input.state);
    if (!oauthState) {
      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "error",
          message: "登录状态无效或已失效",
        }),
      };
    }

    if (oauthState.usedAt) {
      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "error",
          message: "登录回调已被处理",
        }),
      };
    }

    if (oauthState.expiresAt.getTime() <= Date.now()) {
      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "error",
          message: "登录状态已过期，请重新发起登录",
        }),
      };
    }

    try {
      const tokens = await this.protocolAdapter.exchangeCodeForTokens({
        code: input.code,
        state: input.state,
        codeVerifier: oauthState.codeVerifier,
        redirectUri: oauthState.redirectUri,
        config: this.config,
      });
      await this.persistTokenResponse(tokens);
      await this.dao.markOAuthStateUsed(oauthState.state, new Date());

      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "success",
        }),
      };
    } catch (error) {
      await this.dao.markOAuthStateUsed(oauthState.state, new Date());
      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "error",
          message: error instanceof Error ? error.message : "登录失败，请稍后重试",
        }),
      };
    }
  }

  public async logout(): Promise<OAuthLogoutResponse> {
    await this.dao.upsertSession({
      provider: this.providerId,
      accountId: null,
      email: null,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      expiresAt: null,
      lastRefreshAt: null,
      status: "logged_out",
      lastError: null,
    });

    return {
      success: true,
      status: "logged_out",
    };
  }

  public async refresh(): Promise<TRefreshResponse> {
    const auth = await this.getAuth({ forceRefresh: true });
    const nextSession = await this.loadSession();
    if (!nextSession) {
      throw new BizError({
        message: `${this.displayName} 登录状态不可用`,
        meta: {
          provider: this.providerId,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    if (!auth.accessToken) {
      throw new BizError({
        message: `${this.displayName} 登录状态不可用`,
        meta: {
          provider: this.providerId,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    return this.refreshResponseMapper(nextSession);
  }

  public async hasCredentials(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    const session = await this.loadSession();
    if (!session) {
      return false;
    }

    return session.status === "active" || session.status === "expired";
  }

  public async getAuthWithoutRefresh(): Promise<TProviderAuth> {
    this.assertEnabled();
    const session = await this.peekSession();
    if (!session || !session.refreshToken || !session.accessToken || !session.expiresAt) {
      throw new BizError({
        message: `${this.displayName} 登录状态不可用`,
        meta: {
          provider: this.providerId,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    return await this.toProviderAuth(session);
  }

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<TProviderAuth> {
    this.assertEnabled();
    const session = await this.loadSession();
    if (!session || !session.refreshToken || !session.accessToken || !session.expiresAt) {
      throw new BizError({
        message: `${this.displayName} 登录状态不可用`,
        meta: {
          provider: this.providerId,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    if (!(options?.forceRefresh ?? false) && !this.isRefreshRequired(session)) {
      return await this.toProviderAuth(session);
    }

    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    this.refreshPromise = this.refreshSession(session);

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async peekSession(): Promise<TSession | null> {
    return await this.dao.findSession(this.providerId);
  }

  private async loadSession(): Promise<TSession | null> {
    const session = await this.peekSession();
    if (!session) {
      return null;
    }

    const normalizedStatus = this.resolveSessionStatus(session);
    if (normalizedStatus !== session.status) {
      return await this.persistSessionStatus(session, normalizedStatus, session.lastError);
    }

    return session;
  }

  private isRefreshRequired(session: TSession): boolean {
    if (!session.expiresAt) {
      return true;
    }

    return session.expiresAt.getTime() - this.config.refreshLeewayMs <= Date.now();
  }

  private async refreshSession(session: TSession): Promise<TProviderAuth> {
    if (!session.refreshToken) {
      throw new BizError({
        message: `${this.displayName} 登录状态不可用`,
        meta: {
          provider: this.providerId,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    try {
      const decodedRefreshToken = await this.secretStore.decode(session.refreshToken);
      const refreshed = await this.protocolAdapter.refreshTokens({
        refreshToken: decodedRefreshToken,
        config: this.config,
      });
      const nextSession = await this.persistTokenResponse(refreshed);
      return await this.toProviderAuth(nextSession);
    } catch (error) {
      const fallbackStatus = this.resolveSessionStatus(session);
      await this.persistSessionStatus(
        session,
        fallbackStatus,
        error instanceof Error ? error.message : "票据刷新失败",
      );
      throw new BizError({
        message: `${this.displayName} 登录状态不可用`,
        meta: {
          provider: this.providerId,
          reason: "AUTH_REFRESH_FAILED",
        },
        cause: error,
      });
    }
  }

  private async persistTokenResponse(tokens: TTokenResponse): Promise<TSession> {
    return await this.dao.upsertSession({
      provider: this.providerId,
      accountId: tokens.accountId ?? null,
      email: tokens.email ?? null,
      accessToken: await this.secretStore.encode(tokens.accessToken),
      refreshToken: await this.secretStore.encode(tokens.refreshToken),
      idToken: tokens.idToken ? await this.secretStore.encode(tokens.idToken) : null,
      expiresAt: tokens.expiresAt,
      lastRefreshAt: tokens.lastRefreshAt,
      status: "active",
      lastError: null,
    });
  }

  private async persistSessionStatus(
    session: TSession,
    status: Exclude<OAuthStatus, "unavailable">,
    lastError: string | null,
  ): Promise<TSession> {
    return await this.dao.upsertSession({
      provider: this.providerId,
      accountId: session.accountId,
      email: session.email,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      idToken: session.idToken,
      expiresAt: session.expiresAt,
      lastRefreshAt: session.lastRefreshAt,
      status,
      lastError,
    });
  }

  private async toProviderAuth(session: TSession): Promise<TProviderAuth> {
    if (
      !session.accessToken ||
      !session.refreshToken ||
      !session.lastRefreshAt ||
      !session.expiresAt
    ) {
      throw new BizError({
        message: `${this.displayName} 登录状态不可用`,
        meta: {
          provider: this.providerId,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    return this.providerAuthMapper({
      session,
      accessToken: await this.secretStore.decode(session.accessToken),
      refreshToken: await this.secretStore.decode(session.refreshToken),
      idToken: session.idToken ? await this.secretStore.decode(session.idToken) : null,
    });
  }

  private buildResultRedirectUrl(input: { result: "success" | "error"; message?: string }): string {
    const base = this.config.publicBaseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}${this.managementPath}`);
    url.searchParams.set("result", input.result);
    if (input.message) {
      url.searchParams.set("message", input.message);
    }
    return url.toString();
  }

  private assertEnabled(): void {
    if (this.config.enabled) {
      return;
    }

    throw new BizError({
      message: `${this.displayName} 内置登录未启用`,
      meta: {
        provider: this.providerId,
        reason: "AUTH_DISABLED",
      },
    });
  }

  private resolveSessionStatus(
    session: TSession,
  ): Exclude<OAuthStatus, "refresh_failed" | "unavailable"> {
    if (session.status === "logged_out") {
      return "logged_out";
    }

    if (!session.accessToken || !session.refreshToken || !session.expiresAt) {
      return "logged_out";
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      return "expired";
    }

    return "active";
  }
}
