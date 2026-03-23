import type {
  CodexAuthLoginUrlResponse,
  CodexAuthLogoutResponse,
  CodexAuthRefreshResponse,
  CodexAuthStatus,
  CodexAuthStatusResponse,
} from "@kagami/shared";
import { BizError } from "../errors/biz-error.js";
import type { CodexAuthRuntimeConfig } from "../config/config.manager.js";
import { CodexAuthCallbackServer, getCodexAuthCallbackUrl } from "../codex-auth/callback-server.js";
import type { CodexAuthDao } from "../dao/codex-auth.dao.js";
import {
  buildCodexAuthorizeUrl,
  createPkcePair,
  exchangeCodeForTokens,
  refreshCodexTokens,
} from "../codex-auth/oauth.js";
import {
  PlainTextCodexAuthSecretStore,
  type CodexAuthSecretStore,
} from "../codex-auth/secret-store.js";
import type {
  CodexAuthSessionRecord,
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
const refreshPromises = new Map<string, Promise<CodexProviderAuth>>();

export class DefaultCodexAuthService implements CodexAuthService {
  private readonly codexAuthDao: CodexAuthDao;
  private readonly config: CodexAuthRuntimeConfig;
  private readonly callbackServer: CodexAuthCallbackServer;
  private readonly secretStore: CodexAuthSecretStore;

  public constructor({
    codexAuthDao,
    config,
    callbackServer,
    secretStore,
  }: DefaultCodexAuthServiceDeps) {
    this.codexAuthDao = codexAuthDao;
    this.config = config;
    this.callbackServer = callbackServer;
    this.secretStore = secretStore ?? new PlainTextCodexAuthSecretStore();
  }

  public async getStatus(): Promise<CodexAuthStatusResponse> {
    const session = await this.loadSession();
    return toStatusResponse(session);
  }

  public async createLoginUrl(): Promise<CodexAuthLoginUrlResponse> {
    this.assertEnabled();
    await this.callbackServer.beginAuthorizationWindow(this.config.oauthStateTtlMs);

    try {
      await this.codexAuthDao.deleteExpiredOAuthStates(new Date());

      const pkce = createPkcePair();
      const redirectUri = this.getRedirectUri();
      const expiresAt = new Date(Date.now() + this.config.oauthStateTtlMs);
      await this.codexAuthDao.createOAuthState({
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        redirectUri,
        expiresAt,
      });

      return {
        loginUrl: buildCodexAuthorizeUrl({
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
    input: HandleCodexAuthCallbackInput,
  ): Promise<HandleCodexAuthCallbackResult> {
    this.assertEnabled();
    const oauthState = await this.codexAuthDao.findOAuthState(input.state);
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
        codeVerifier: oauthState.codeVerifier,
        redirectUri: oauthState.redirectUri,
        config: this.config,
      });
      await this.persistTokenResponse(tokens, "active", null);
      await this.codexAuthDao.markOAuthStateUsed(oauthState.state, new Date());

      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "success",
        }),
      };
    } catch (error) {
      await this.codexAuthDao.markOAuthStateUsed(oauthState.state, new Date());
      return {
        redirectUrl: this.buildResultRedirectUrl({
          result: "error",
          message: error instanceof Error ? error.message : "登录失败，请稍后重试",
        }),
      };
    }
  }

  public async logout(): Promise<CodexAuthLogoutResponse> {
    await this.codexAuthDao.upsertSession({
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

  public async refresh(): Promise<CodexAuthRefreshResponse> {
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

  public async getAuth(options?: { forceRefresh?: boolean }): Promise<CodexProviderAuth> {
    this.assertEnabled();
    const session = await this.loadSession();
    if (!session || !session.refreshToken || !session.accessToken || !session.expiresAt) {
      throw new BizError({
        message: "Codex 登录状态不可用",
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

  private async loadSession(): Promise<CodexAuthSessionRecord | null> {
    const session = await this.codexAuthDao.findSession(PROVIDER_ID);
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

  private isRefreshRequired(session: CodexAuthSessionRecord): boolean {
    if (!session.expiresAt) {
      return true;
    }

    return session.expiresAt.getTime() - this.config.refreshLeewayMs <= Date.now();
  }

  private async refreshSession(session: CodexAuthSessionRecord): Promise<CodexProviderAuth> {
    if (!session.refreshToken) {
      throw new BizError({
        message: "Codex 登录状态不可用",
        meta: {
          provider: PROVIDER_ID,
          reason: "AUTH_UNAVAILABLE",
        },
      });
    }

    try {
      const decodedRefreshToken = await this.secretStore.decode(session.refreshToken);
      const refreshed = await refreshCodexTokens({
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
        message: "Codex 登录状态不可用",
        meta: {
          provider: PROVIDER_ID,
          reason: "AUTH_REFRESH_FAILED",
        },
        cause: error,
      });
    }
  }

  private async persistTokenResponse(
    tokens: CodexTokenResponse,
    status: "active" | "refresh_failed",
    lastError: string | null,
  ): Promise<CodexAuthSessionRecord> {
    return this.codexAuthDao.upsertSession({
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
    session: CodexAuthSessionRecord,
    status: Exclude<CodexAuthStatus, "unavailable">,
    lastError: string | null,
  ): Promise<CodexAuthSessionRecord> {
    return this.codexAuthDao.upsertSession({
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

  private async toProviderAuth(session: CodexAuthSessionRecord): Promise<CodexProviderAuth> {
    if (
      !session.accessToken ||
      !session.refreshToken ||
      !session.lastRefreshAt ||
      !session.expiresAt
    ) {
      throw new BizError({
        message: "Codex 登录状态不可用",
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
    return getCodexAuthCallbackUrl(this.config.oauthRedirectPath);
  }

  private buildResultRedirectUrl(input: { result: "success" | "error"; message?: string }): string {
    const base = this.config.publicBaseUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/codex-auth`);
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
      message: "Codex 内置登录未启用",
      meta: {
        provider: PROVIDER_ID,
        reason: "AUTH_DISABLED",
      },
    });
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
