import type {
  ClaudeCodeAuthLoginUrlResponse,
  ClaudeCodeAuthLogoutResponse,
  ClaudeCodeAuthRefreshResponse,
  ClaudeCodeAuthStatus,
  ClaudeCodeAuthStatusResponse,
} from "@kagami/shared";
import { BizError } from "../errors/biz-error.js";
import type { ClaudeCodeAuthRuntimeConfig } from "../config/config.manager.js";
import {
  ClaudeCodeAuthCallbackServer,
  getClaudeCodeAuthCallbackUrl,
} from "../claude-code-auth/callback-server.js";
import type { ClaudeCodeAuthDao } from "../dao/claude-code-auth.dao.js";
import {
  buildClaudeCodeAuthorizeUrl,
  createPkcePair,
  exchangeCodeForTokens,
  refreshClaudeCodeTokens,
} from "../claude-code-auth/oauth.js";
import {
  PlainTextClaudeCodeAuthSecretStore,
  type ClaudeCodeAuthSecretStore,
} from "../claude-code-auth/secret-store.js";
import type {
  ClaudeCodeAuthSessionRecord,
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
const refreshPromises = new Map<string, Promise<ClaudeCodeProviderAuth>>();

export class DefaultClaudeCodeAuthService implements ClaudeCodeAuthService {
  private readonly claudeCodeAuthDao: ClaudeCodeAuthDao;
  private readonly config: ClaudeCodeAuthRuntimeConfig;
  private readonly callbackServer: ClaudeCodeAuthCallbackServer;
  private readonly secretStore: ClaudeCodeAuthSecretStore;

  public constructor({
    claudeCodeAuthDao,
    config,
    callbackServer,
    secretStore,
  }: DefaultClaudeCodeAuthServiceDeps) {
    this.claudeCodeAuthDao = claudeCodeAuthDao;
    this.config = config;
    this.callbackServer = callbackServer;
    this.secretStore = secretStore ?? new PlainTextClaudeCodeAuthSecretStore();
  }

  public async getStatus(): Promise<ClaudeCodeAuthStatusResponse> {
    const session = await this.loadSession();
    return toStatusResponse(session);
  }

  public async createLoginUrl(): Promise<ClaudeCodeAuthLoginUrlResponse> {
    this.assertEnabled();
    await this.callbackServer.beginAuthorizationWindow(this.config.oauthStateTtlMs);

    try {
      await this.claudeCodeAuthDao.deleteExpiredOAuthStates(new Date());

      const pkce = createPkcePair();
      const redirectUri = this.getRedirectUri();
      const expiresAt = new Date(Date.now() + this.config.oauthStateTtlMs);
      await this.claudeCodeAuthDao.createOAuthState({
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        expiresAt,
      });

      return {
        loginUrl: buildClaudeCodeAuthorizeUrl({
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

  public async handleCallback(
    input: HandleClaudeCodeAuthCallbackInput,
  ): Promise<HandleClaudeCodeAuthCallbackResult> {
    this.assertEnabled();
    const oauthState = await this.claudeCodeAuthDao.findOAuthState(input.state);
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
      const tokens = await exchangeCodeForTokens({
        code: input.code,
        state: input.state,
        codeVerifier: oauthState.codeVerifier,
        redirectUri: oauthState.redirectUri,
        config: this.config,
      });
      await this.persistTokenResponse(tokens, "active", null);
      await this.claudeCodeAuthDao.markOAuthStateUsed(oauthState.state, new Date());

      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "success",
        }),
      };
    } catch (error) {
      await this.claudeCodeAuthDao.markOAuthStateUsed(oauthState.state, new Date());
      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "error",
          message: error instanceof Error ? error.message : "登录失败，请稍后重试",
        }),
      };
    }
  }

  public async logout(): Promise<ClaudeCodeAuthLogoutResponse> {
    await this.claudeCodeAuthDao.upsertSession({
      provider: PROVIDER_ID,
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

  public async refresh(): Promise<ClaudeCodeAuthRefreshResponse> {
    const auth = await this.getAuth({ forceRefresh: true });
    return {
      success: true,
      status: "active",
      session: {
        provider: PROVIDER_ID,
        accountId: auth.accountId ?? null,
        email: auth.email ?? null,
        expiresAt: new Date(auth.expiresAt).toISOString(),
        lastRefreshAt: auth.lastRefresh,
        lastError: null,
      },
    };
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

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<ClaudeCodeProviderAuth> {
    this.assertEnabled();
    const session = await this.loadSession();
    if (!session || !session.refreshToken || !session.accessToken || !session.expiresAt) {
      throw new BizError({
        message: "Claude Code 登录状态不可用",
        meta: {
          provider: PROVIDER_ID,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    if (!(options?.forceRefresh ?? false) && !this.isRefreshRequired(session)) {
      return this.toProviderAuth(session);
    }

    const pending = refreshPromises.get(PROVIDER_ID);
    if (pending) {
      return pending;
    }

    const refreshPromise = this.refreshSession(session);
    refreshPromises.set(PROVIDER_ID, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      refreshPromises.delete(PROVIDER_ID);
    }
  }

  private async loadSession(): Promise<ClaudeCodeAuthSessionRecord | null> {
    const session = await this.claudeCodeAuthDao.findSession(PROVIDER_ID);
    if (!session) {
      return null;
    }

    if (
      session.status === "active" &&
      session.expiresAt &&
      session.expiresAt.getTime() <= Date.now()
    ) {
      return await this.persistSessionStatus(session, "expired", session.lastError);
    }

    return session;
  }

  private isRefreshRequired(session: ClaudeCodeAuthSessionRecord): boolean {
    if (!session.expiresAt) {
      return true;
    }

    return session.expiresAt.getTime() - this.config.refreshLeewayMs <= Date.now();
  }

  private async refreshSession(
    session: ClaudeCodeAuthSessionRecord,
  ): Promise<ClaudeCodeProviderAuth> {
    if (!session.refreshToken) {
      throw new BizError({
        message: "Claude Code 登录状态不可用",
        meta: {
          provider: PROVIDER_ID,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    try {
      const decodedRefreshToken = await this.secretStore.decode(session.refreshToken);
      const refreshed = await refreshClaudeCodeTokens({
        refreshToken: decodedRefreshToken,
        config: this.config,
      });
      const nextSession = await this.persistTokenResponse(refreshed, "active", null);
      return this.toProviderAuth(nextSession);
    } catch (error) {
      await this.persistSessionStatus(
        session,
        "refresh_failed",
        error instanceof Error ? error.message : "票据刷新失败",
      );
      throw new BizError({
        message: "Claude Code 登录状态不可用",
        meta: {
          provider: PROVIDER_ID,
          reason: "AUTH_REFRESH_FAILED",
        },
        cause: error,
      });
    }
  }

  private async persistTokenResponse(
    tokens: ClaudeCodeTokenResponse,
    status: "active" | "refresh_failed",
    lastError: string | null,
  ): Promise<ClaudeCodeAuthSessionRecord> {
    return this.claudeCodeAuthDao.upsertSession({
      provider: PROVIDER_ID,
      accountId: tokens.accountId ?? null,
      email: tokens.email ?? null,
      accessToken: await this.secretStore.encode(tokens.accessToken),
      refreshToken: await this.secretStore.encode(tokens.refreshToken),
      idToken: tokens.idToken ? await this.secretStore.encode(tokens.idToken) : null,
      expiresAt: tokens.expiresAt,
      lastRefreshAt: tokens.lastRefreshAt,
      status,
      lastError,
    });
  }

  private async persistSessionStatus(
    session: ClaudeCodeAuthSessionRecord,
    status: Exclude<ClaudeCodeAuthStatus, "unavailable">,
    lastError: string | null,
  ): Promise<ClaudeCodeAuthSessionRecord> {
    return this.claudeCodeAuthDao.upsertSession({
      provider: PROVIDER_ID,
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

  private async toProviderAuth(
    session: ClaudeCodeAuthSessionRecord,
  ): Promise<ClaudeCodeProviderAuth> {
    if (
      !session.accessToken ||
      !session.refreshToken ||
      !session.lastRefreshAt ||
      !session.expiresAt
    ) {
      throw new BizError({
        message: "Claude Code 登录状态不可用",
        meta: {
          provider: PROVIDER_ID,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    return {
      accessToken: await this.secretStore.decode(session.accessToken),
      refreshToken: await this.secretStore.decode(session.refreshToken),
      ...(session.idToken ? { idToken: await this.secretStore.decode(session.idToken) } : {}),
      ...(session.accountId ? { accountId: session.accountId } : {}),
      ...(session.email ? { email: session.email } : {}),
      lastRefresh: session.lastRefreshAt.toISOString(),
      expiresAt: session.expiresAt.getTime(),
    };
  }

  private getRedirectUri(): string {
    return getClaudeCodeAuthCallbackUrl();
  }

  private buildResultRedirectUrl(input: { result: "success" | "error"; message?: string }): string {
    const base = this.config.publicBaseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/claude-code-auth`);
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
      message: "Claude Code 内置登录未启用",
      meta: {
        provider: PROVIDER_ID,
        reason: "AUTH_DISABLED",
      },
    });
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
