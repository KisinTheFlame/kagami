import type {
  CodexAuthLoginUrlResponse,
  CodexAuthLogoutResponse,
  CodexAuthRefreshResponse,
  CodexAuthStatusResponse,
} from "@kagami/shared";
import { SharedOAuthServiceCore } from "../auth/shared/service.js";
import type { OAuthProviderAuth } from "../auth/shared/types.js";
import type { CodexAuthRuntimeConfig } from "../config/config.manager.js";
import { CodexAuthCallbackServer, getCodexAuthCallbackUrl } from "../codex-auth/callback-server.js";
import type { CodexAuthDao } from "../dao/codex-auth.dao.js";
import {
  buildCodexAuthorizeUrl,
  exchangeCodeForTokens,
  refreshCodexTokens,
} from "../codex-auth/oauth.js";
import {
  PlainTextCodexAuthSecretStore,
  type CodexAuthSecretStore,
} from "../codex-auth/secret-store.js";
import type {
  CodexAuthSessionRecord,
  CodexOAuthStateRecord,
  CodexProviderAuth,
  CodexTokenResponse,
} from "../codex-auth/types.js";
import type {
  CodexAuthService,
  HandleCodexAuthCallbackInput,
  HandleCodexAuthCallbackResult,
} from "./codex-auth.service.js";

type DefaultCodexAuthServiceDeps = {
  codexAuthDao: CodexAuthDao;
  config: CodexAuthRuntimeConfig;
  callbackServer: CodexAuthCallbackServer;
  secretStore?: CodexAuthSecretStore;
};

const PROVIDER_ID = "openai-codex";

export class DefaultCodexAuthService implements CodexAuthService {
  private readonly core: SharedOAuthServiceCore<
    "openai-codex",
    CodexAuthSessionRecord,
    CodexOAuthStateRecord,
    CodexAuthStatusResponse,
    CodexAuthRefreshResponse,
    CodexProviderAuth,
    CodexTokenResponse
  >;

  public constructor({
    codexAuthDao,
    config,
    callbackServer,
    secretStore,
  }: DefaultCodexAuthServiceDeps) {
    this.core = new SharedOAuthServiceCore({
      dao: codexAuthDao,
      config,
      callbackServer,
      secretStore: secretStore ?? new PlainTextCodexAuthSecretStore(),
      providerId: PROVIDER_ID,
      displayName: "Codex",
      managementPath: "/codex-auth",
      protocolAdapter: {
        buildAuthorizeUrl: buildCodexAuthorizeUrl,
        exchangeCodeForTokens: input =>
          exchangeCodeForTokens({
            code: input.code,
            codeVerifier: input.codeVerifier,
            redirectUri: input.redirectUri,
            config: input.config,
          }),
        refreshTokens: refreshCodexTokens,
        getRedirectUri: oauthRedirectPath => getCodexAuthCallbackUrl(oauthRedirectPath),
      },
      toStatusResponse,
      toRefreshResponse,
      toProviderAuth: mapProviderAuth,
    });
  }

  public async getStatus(): Promise<CodexAuthStatusResponse> {
    return await this.core.getStatus();
  }

  public async createLoginUrl(): Promise<CodexAuthLoginUrlResponse> {
    return await this.core.createLoginUrl();
  }

  public async handleCallback(
    input: HandleCodexAuthCallbackInput,
  ): Promise<HandleCodexAuthCallbackResult> {
    return await this.core.handleCallback(input);
  }

  public async logout(): Promise<CodexAuthLogoutResponse> {
    return await this.core.logout();
  }

  public async refresh(): Promise<CodexAuthRefreshResponse> {
    return await this.core.refresh();
  }

  public async hasCredentials(): Promise<boolean> {
    return await this.core.hasCredentials();
  }

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<CodexProviderAuth> {
    return await this.core.getAuth(options);
  }
}

function toStatusResponse(session: CodexAuthSessionRecord | null): CodexAuthStatusResponse {
  if (!session) {
    return {
      status: "unavailable",
      isLoggedIn: false,
      session: null,
    };
  }

  return {
    status: session.status,
    isLoggedIn: session.status === "active" || session.status === "expired",
    session: {
      provider: PROVIDER_ID,
      accountId: session.accountId,
      email: session.email,
      expiresAt: session.expiresAt?.toISOString() ?? null,
      lastRefreshAt: session.lastRefreshAt?.toISOString() ?? null,
      lastError: session.lastError,
    },
  };
}

function toRefreshResponse(session: CodexAuthSessionRecord): CodexAuthRefreshResponse {
  return {
    success: true,
    status: "active",
    session: {
      provider: PROVIDER_ID,
      accountId: session.accountId,
      email: session.email,
      expiresAt: session.expiresAt?.toISOString() ?? null,
      lastRefreshAt: session.lastRefreshAt?.toISOString() ?? null,
      lastError: session.lastError,
    },
  };
}

function mapProviderAuth(input: {
  session: CodexAuthSessionRecord;
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
}): CodexProviderAuth {
  return toProviderAuthShape(input);
}

function toProviderAuthShape(input: {
  session: CodexAuthSessionRecord;
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
