import type {
  AuthLoginUrlResponse,
  AuthLogoutResponse,
  AuthProvider,
  AuthRefreshResponse,
  AuthStatusResponse,
  AuthUsageLimitsResponse,
} from "@kagami/shared";
import { SharedOAuthServiceCore } from "../shared/service.js";
import type {
  OAuthCallbackInput,
  OAuthCallbackResult,
  OAuthCallbackServerLike,
  OAuthDao,
  OAuthProviderAuth,
  OAuthRuntimeConfig,
  OAuthSecretStore,
  OAuthSessionRecord,
  OAuthStateRecord,
  OAuthTokenResponse,
} from "../shared/types.js";
import { toPublicAuthProvider, type InternalAuthProvider } from "../domain/auth-provider.js";

type OAuthProtocolAdapter<
  TConfig extends OAuthRuntimeConfig,
  TTokenResponse extends OAuthTokenResponse,
> = {
  buildAuthorizeUrl(input: { redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCodeForTokens(input: {
    code: string;
    state: string;
    codeVerifier: string;
    redirectUri: string;
    config: TConfig;
  }): Promise<TTokenResponse>;
  refreshTokens(input: { refreshToken: string; config: TConfig }): Promise<TTokenResponse>;
  getRedirectUri(oauthRedirectPath: string): string;
};

type DefaultOAuthAuthServiceDeps<
  TInternalProvider extends InternalAuthProvider,
  TConfig extends OAuthRuntimeConfig,
  TSession extends OAuthSessionRecord<TInternalProvider>,
  TState extends OAuthStateRecord,
  TTokenResponse extends OAuthTokenResponse,
  TUsageLimits extends AuthUsageLimitsResponse,
> = {
  publicProvider: AuthProvider;
  internalProvider: TInternalProvider;
  displayName: string;
  managementPath: string;
  dao: OAuthDao<TInternalProvider, TSession, TState>;
  config: TConfig;
  callbackServer: OAuthCallbackServerLike;
  secretStore: OAuthSecretStore;
  protocolAdapter: OAuthProtocolAdapter<TConfig, TTokenResponse>;
  createEmptyUsageLimits(): TUsageLimits;
};

export interface OAuthAuthService<
  TInternalProvider extends InternalAuthProvider = InternalAuthProvider,
> {
  readonly provider?: AuthProvider;
  readonly internalProvider?: TInternalProvider;
  getStatus(): Promise<AuthStatusResponse>;
  createLoginUrl(): Promise<AuthLoginUrlResponse>;
  handleCallback(input: OAuthCallbackInput): Promise<OAuthCallbackResult>;
  logout(): Promise<AuthLogoutResponse>;
  refresh(): Promise<AuthRefreshResponse>;
  getUsageLimits(): Promise<AuthUsageLimitsResponse>;
  hasCredentials(): Promise<boolean>;
  getAuthWithoutRefresh(): Promise<OAuthProviderAuth>;
  getAuth(options?: { forceRefresh?: boolean }): Promise<OAuthProviderAuth>;
  setUsageLimitsProvider?(
    provider: () => Promise<AuthUsageLimitsResponse> | AuthUsageLimitsResponse,
  ): void;
}

export class DefaultOAuthAuthService<
  TInternalProvider extends InternalAuthProvider,
  TConfig extends OAuthRuntimeConfig,
  TSession extends OAuthSessionRecord<TInternalProvider>,
  TState extends OAuthStateRecord,
  TTokenResponse extends OAuthTokenResponse,
  TUsageLimits extends AuthUsageLimitsResponse,
> implements OAuthAuthService<TInternalProvider> {
  public readonly provider: AuthProvider;
  public readonly internalProvider: TInternalProvider;
  private readonly core: SharedOAuthServiceCore<
    TInternalProvider,
    TSession,
    TState,
    AuthStatusResponse,
    AuthRefreshResponse,
    OAuthProviderAuth,
    TTokenResponse
  >;
  private readonly emptyUsageLimits: TUsageLimits;
  private usageLimitsProvider:
    | (() => Promise<AuthUsageLimitsResponse> | AuthUsageLimitsResponse)
    | null = null;

  public constructor({
    publicProvider,
    internalProvider,
    displayName,
    managementPath,
    dao,
    config,
    callbackServer,
    secretStore,
    protocolAdapter,
    createEmptyUsageLimits,
  }: DefaultOAuthAuthServiceDeps<
    TInternalProvider,
    TConfig,
    TSession,
    TState,
    TTokenResponse,
    TUsageLimits
  >) {
    this.provider = publicProvider;
    this.internalProvider = internalProvider;
    this.emptyUsageLimits = createEmptyUsageLimits();
    this.core = new SharedOAuthServiceCore({
      dao,
      config,
      callbackServer,
      secretStore,
      providerId: internalProvider,
      displayName,
      managementPath,
      protocolAdapter,
      toStatusResponse: session => toStatusResponse(publicProvider, session),
      toRefreshResponse: session => toRefreshResponse(publicProvider, session),
      toProviderAuth: input => toProviderAuth(input),
    });
  }

  public async getStatus(): Promise<AuthStatusResponse> {
    return await this.core.getStatus();
  }

  public async createLoginUrl(): Promise<AuthLoginUrlResponse> {
    const result = await this.core.createLoginUrl();
    return {
      provider: this.provider,
      ...result,
    };
  }

  public async handleCallback(input: OAuthCallbackInput): Promise<OAuthCallbackResult> {
    return await this.core.handleCallback(input);
  }

  public async logout(): Promise<AuthLogoutResponse> {
    const result = await this.core.logout();
    return {
      provider: this.provider,
      ...result,
    };
  }

  public async refresh(): Promise<AuthRefreshResponse> {
    return await this.core.refresh();
  }

  public async getUsageLimits(): Promise<AuthUsageLimitsResponse> {
    if (!this.usageLimitsProvider) {
      return this.emptyUsageLimits;
    }

    return await this.usageLimitsProvider();
  }

  public async hasCredentials(): Promise<boolean> {
    return await this.core.hasCredentials();
  }

  public async getAuthWithoutRefresh(): Promise<OAuthProviderAuth> {
    return await this.core.getAuthWithoutRefresh();
  }

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<OAuthProviderAuth> {
    return await this.core.getAuth(options);
  }

  public setUsageLimitsProvider(
    provider: () => Promise<AuthUsageLimitsResponse> | AuthUsageLimitsResponse,
  ): void {
    this.usageLimitsProvider = provider;
  }
}

function toStatusResponse(
  provider: AuthProvider,
  session: OAuthSessionRecord<InternalAuthProvider> | null,
): AuthStatusResponse {
  if (!session) {
    return {
      provider,
      status: "unavailable",
      isLoggedIn: false,
      session: null,
    };
  }

  return {
    provider,
    status: session.status,
    isLoggedIn: session.status === "active" || session.status === "expired",
    session: {
      provider,
      accountId: session.accountId,
      email: session.email,
      expiresAt: session.expiresAt?.toISOString() ?? null,
      lastRefreshAt: session.lastRefreshAt?.toISOString() ?? null,
      lastError: session.lastError,
    },
  };
}

function toRefreshResponse(
  provider: AuthProvider,
  session: OAuthSessionRecord<InternalAuthProvider>,
): AuthRefreshResponse {
  return {
    provider,
    success: true,
    status: session.status,
    session: {
      provider,
      accountId: session.accountId,
      email: session.email,
      expiresAt: session.expiresAt?.toISOString() ?? null,
      lastRefreshAt: session.lastRefreshAt?.toISOString() ?? null,
      lastError: session.lastError,
    },
  };
}

function toProviderAuth(input: {
  session: OAuthSessionRecord<InternalAuthProvider>;
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
}): OAuthProviderAuth {
  return {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    ...(input.idToken ? { idToken: input.idToken } : {}),
    ...(input.session.accountId ? { accountId: input.session.accountId } : {}),
    ...(input.session.email ? { email: input.session.email } : {}),
    lastRefresh: input.session.lastRefreshAt?.toISOString() ?? new Date(0).toISOString(),
    expiresAt: input.session.expiresAt?.getTime() ?? 0,
  };
}

export function assertInternalAuthProvider(provider: string): InternalAuthProvider {
  const publicProvider =
    provider === "openai-codex" || provider === "claude-code" ? provider : null;
  if (!publicProvider) {
    throw new Error(`Unsupported auth provider: ${provider}`);
  }

  return publicProvider;
}

export function createEmptyAuthStatusResponse(provider: InternalAuthProvider): AuthStatusResponse {
  return {
    provider: toPublicAuthProvider(provider),
    status: "unavailable",
    isLoggedIn: false,
    session: null,
  };
}
