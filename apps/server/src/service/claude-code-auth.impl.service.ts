import type {
  ClaudeCodeAuthLoginUrlResponse,
  ClaudeCodeAuthLogoutResponse,
  ClaudeCodeAuthRefreshResponse,
  ClaudeCodeAuthStatusResponse,
} from "@kagami/shared";
import { SharedOAuthServiceCore } from "../auth/shared/service.js";
import type { OAuthProviderAuth } from "../auth/shared/types.js";
import type { ClaudeCodeAuthRuntimeConfig } from "../config/config.manager.js";
import {
  ClaudeCodeAuthCallbackServer,
  getClaudeCodeAuthCallbackUrl,
} from "../claude-code-auth/callback-server.js";
import type { ClaudeCodeAuthDao } from "../dao/claude-code-auth.dao.js";
import {
  buildClaudeCodeAuthorizeUrl,
  exchangeCodeForTokens,
  refreshClaudeCodeTokens,
} from "../claude-code-auth/oauth.js";
import {
  PlainTextClaudeCodeAuthSecretStore,
  type ClaudeCodeAuthSecretStore,
} from "../claude-code-auth/secret-store.js";
import type {
  ClaudeCodeAuthSessionRecord,
  ClaudeCodeOAuthStateRecord,
  ClaudeCodeProviderAuth,
  ClaudeCodeTokenResponse,
} from "../claude-code-auth/types.js";
import type {
  ClaudeCodeAuthService,
  HandleClaudeCodeAuthCallbackInput,
  HandleClaudeCodeAuthCallbackResult,
} from "./claude-code-auth.service.js";

type DefaultClaudeCodeAuthServiceDeps = {
  claudeCodeAuthDao: ClaudeCodeAuthDao;
  config: ClaudeCodeAuthRuntimeConfig;
  callbackServer: ClaudeCodeAuthCallbackServer;
  secretStore?: ClaudeCodeAuthSecretStore;
};

const PROVIDER_ID = "claude-code";

export class DefaultClaudeCodeAuthService implements ClaudeCodeAuthService {
  private readonly core: SharedOAuthServiceCore<
    "claude-code",
    ClaudeCodeAuthSessionRecord,
    ClaudeCodeOAuthStateRecord,
    ClaudeCodeAuthStatusResponse,
    ClaudeCodeAuthRefreshResponse,
    ClaudeCodeProviderAuth,
    ClaudeCodeTokenResponse
  >;

  public constructor({
    claudeCodeAuthDao,
    config,
    callbackServer,
    secretStore,
  }: DefaultClaudeCodeAuthServiceDeps) {
    this.core = new SharedOAuthServiceCore({
      dao: claudeCodeAuthDao,
      config,
      callbackServer,
      secretStore: secretStore ?? new PlainTextClaudeCodeAuthSecretStore(),
      providerId: PROVIDER_ID,
      displayName: "Claude Code",
      managementPath: "/auth/claude-code",
      protocolAdapter: {
        buildAuthorizeUrl: buildClaudeCodeAuthorizeUrl,
        exchangeCodeForTokens: input =>
          exchangeCodeForTokens({
            code: input.code,
            state: input.state,
            codeVerifier: input.codeVerifier,
            redirectUri: input.redirectUri,
            config: input.config,
          }),
        refreshTokens: refreshClaudeCodeTokens,
        getRedirectUri: () => getClaudeCodeAuthCallbackUrl(),
      },
      toStatusResponse,
      toRefreshResponse,
      toProviderAuth: mapProviderAuth,
    });
  }

  public async getStatus(): Promise<ClaudeCodeAuthStatusResponse> {
    return await this.core.getStatus();
  }

  public async createLoginUrl(): Promise<ClaudeCodeAuthLoginUrlResponse> {
    return await this.core.createLoginUrl();
  }

  public async handleCallback(
    input: HandleClaudeCodeAuthCallbackInput,
  ): Promise<HandleClaudeCodeAuthCallbackResult> {
    return await this.core.handleCallback(input);
  }

  public async logout(): Promise<ClaudeCodeAuthLogoutResponse> {
    return await this.core.logout();
  }

  public async refresh(): Promise<ClaudeCodeAuthRefreshResponse> {
    return await this.core.refresh();
  }

  public async hasCredentials(): Promise<boolean> {
    return await this.core.hasCredentials();
  }

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<ClaudeCodeProviderAuth> {
    return await this.core.getAuth(options);
  }
}

function toStatusResponse(
  session: ClaudeCodeAuthSessionRecord | null,
): ClaudeCodeAuthStatusResponse {
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

function toRefreshResponse(session: ClaudeCodeAuthSessionRecord): ClaudeCodeAuthRefreshResponse {
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
  session: ClaudeCodeAuthSessionRecord;
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
}): ClaudeCodeProviderAuth {
  return toProviderAuthShape(input);
}

function toProviderAuthShape(input: {
  session: ClaudeCodeAuthSessionRecord;
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
