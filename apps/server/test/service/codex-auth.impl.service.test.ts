import { describe, expect, it, vi } from "vitest";
import type { CodexAuthCallbackServer } from "../../src/codex-auth/callback-server.js";
import { DefaultCodexAuthService } from "../../src/service/codex-auth.impl.service.js";
import type { CodexAuthDao } from "../../src/dao/codex-auth.dao.js";
import type { CodexAuthSessionRecord, CodexOAuthStateRecord } from "../../src/codex-auth/types.js";

const baseConfig = {
  enabled: true,
  publicBaseUrl: "http://localhost:20004",
  oauthRedirectPath: "/auth/callback",
  oauthStateTtlMs: 600_000,
  refreshLeewayMs: 60_000,
  timeoutMs: 5_000,
} as const;

function createDao(overrides?: Partial<CodexAuthDao>): CodexAuthDao {
  return {
    findSession: vi.fn().mockResolvedValue(null),
    upsertSession: vi.fn(),
    createOAuthState: vi.fn(),
    findOAuthState: vi.fn().mockResolvedValue(null),
    markOAuthStateUsed: vi.fn(),
    deleteExpiredOAuthStates: vi.fn(),
    ...overrides,
  };
}

function createSession(overrides?: Partial<CodexAuthSessionRecord>): CodexAuthSessionRecord {
  return {
    id: 1,
    provider: "openai-codex",
    accountId: "acct_123",
    email: "bot@example.com",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    idToken: "id-token",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    lastRefreshAt: new Date("2026-03-20T00:00:00.000Z"),
    status: "active",
    lastError: null,
    createdAt: new Date("2026-03-20T00:00:00.000Z"),
    updatedAt: new Date("2026-03-20T00:00:00.000Z"),
    ...overrides,
  };
}

function createOAuthStateRecord(overrides?: Partial<CodexOAuthStateRecord>): CodexOAuthStateRecord {
  return {
    id: 1,
    state: "state-123",
    codeVerifier: "verifier-123",
    redirectUri: "http://localhost:1455/auth/callback",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DefaultCodexAuthService", () => {
  it("should create a login url and persist OAuth state", async () => {
    const createOAuthState = vi.fn(async input => ({
      id: 1,
      createdAt: new Date(),
      usedAt: null,
      ...input,
    }));
    const callbackServer = createCallbackServer();
    const dao = createDao({
      createOAuthState,
    });
    const service = new DefaultCodexAuthService({
      codexAuthDao: dao,
      config: baseConfig,
      callbackServer: callbackServer.instance,
    });

    const result = await service.createLoginUrl();

    expect(result.loginUrl).toContain("https://auth.openai.com/oauth/authorize?");
    expect(result.loginUrl).toContain(
      "redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback",
    );
    expect(createOAuthState).toHaveBeenCalledTimes(1);
    expect(createOAuthState.mock.calls[0]?.[0].redirectUri).toBe(
      "http://localhost:1455/auth/callback",
    );
    expect(callbackServer.beginAuthorizationWindow).toHaveBeenCalledWith(
      baseConfig.oauthStateTtlMs,
    );
    expect(callbackServer.beginAuthorizationWindow.mock.invocationCallOrder[0]).toBeLessThan(
      createOAuthState.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("should stop callback server when login url creation fails", async () => {
    const callbackServer = createCallbackServer();
    const dao = createDao({
      deleteExpiredOAuthStates: vi.fn().mockRejectedValue(new Error("db unavailable")),
    });
    const service = new DefaultCodexAuthService({
      codexAuthDao: dao,
      config: baseConfig,
      callbackServer: callbackServer.instance,
    });

    await expect(service.createLoginUrl()).rejects.toThrow("db unavailable");
    expect(callbackServer.beginAuthorizationWindow).toHaveBeenCalledWith(
      baseConfig.oauthStateTtlMs,
    );
    expect(callbackServer.stop).toHaveBeenCalledTimes(1);
  });

  it("should exchange a valid callback and persist an active session", async () => {
    const oauthState = createOAuthStateRecord();
    const upsertSession = vi.fn(async input =>
      createSession({
        accountId: input.accountId,
        email: input.email,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        expiresAt: input.expiresAt,
        lastRefreshAt: input.lastRefreshAt,
        status: input.status,
        lastError: input.lastError,
      }),
    );
    const dao = createDao({
      findOAuthState: vi.fn().mockResolvedValue(oauthState),
      upsertSession,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
          id_token: [
            "header",
            Buffer.from(
              JSON.stringify({
                email: "codex@example.com",
                "https://api.openai.com/auth": {
                  chatgpt_account_id: "acct_live",
                },
              }),
            ).toString("base64url"),
            "signature",
          ].join("."),
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new DefaultCodexAuthService({
      codexAuthDao: dao,
      config: baseConfig,
      callbackServer: createCallbackServer().instance,
    });

    const result = await service.handleCallback({
      code: "code-123",
      state: oauthState.state,
    });

    expect(result.redirectUrl).toBe("http://localhost:20004/codex-auth?result=success");
    expect(upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-codex",
        accountId: "acct_live",
        email: "codex@example.com",
        status: "active",
      }),
    );
  });

  it("should reject invalid callback state by redirecting with an error", async () => {
    const service = new DefaultCodexAuthService({
      codexAuthDao: createDao(),
      config: baseConfig,
      callbackServer: createCallbackServer().instance,
    });

    const result = await service.handleCallback({
      code: "code-123",
      state: "missing-state",
    });

    expect(result.redirectUrl).toContain("http://localhost:20004/codex-auth?result=error");
    expect(result.redirectUrl).toContain(encodeURIComponent("登录状态无效或已失效"));
  });

  it("should refresh an expiring session and return provider auth", async () => {
    const staleSession = createSession({
      expiresAt: new Date(Date.now() + 5_000),
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
    });
    const upsertSession = vi.fn(async input =>
      createSession({
        accountId: input.accountId,
        email: input.email,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        expiresAt: input.expiresAt,
        lastRefreshAt: input.lastRefreshAt,
        status: input.status,
        lastError: input.lastError,
      }),
    );
    const dao = createDao({
      findSession: vi.fn().mockResolvedValue(staleSession),
      upsertSession,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "next-access",
            refresh_token: "next-refresh",
            id_token: "next-id",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const service = new DefaultCodexAuthService({
      codexAuthDao: dao,
      config: baseConfig,
      callbackServer: createCallbackServer().instance,
    });

    const auth = await service.getAuth();

    expect(auth.accessToken).toBe("next-access");
    expect(auth.refreshToken).toBe("next-refresh");
    expect(upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "next-access",
        refreshToken: "next-refresh",
        status: "active",
      }),
    );
  });

  it("should mark refresh failures and logout state", async () => {
    const staleSession = createSession({
      expiresAt: new Date(Date.now() - 1_000),
    });
    const upsertSession = vi.fn(async input =>
      createSession({
        ...staleSession,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        expiresAt: input.expiresAt,
        lastRefreshAt: input.lastRefreshAt,
        status: input.status,
        lastError: input.lastError,
      }),
    );
    const dao = createDao({
      findSession: vi.fn().mockResolvedValue(staleSession),
      upsertSession,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{}", { status: 401, headers: { "content-type": "application/json" } }),
        ),
    );

    const service = new DefaultCodexAuthService({
      codexAuthDao: dao,
      config: baseConfig,
      callbackServer: createCallbackServer().instance,
    });

    await expect(service.getAuth({ forceRefresh: true })).rejects.toMatchObject({
      message: "Codex 登录状态不可用",
    });
    expect(upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "refresh_failed",
      }),
    );

    const logout = await service.logout();
    expect(logout).toEqual({
      success: true,
      status: "logged_out",
    });
  });
});

function createCallbackServer(): {
  instance: CodexAuthCallbackServer;
  beginAuthorizationWindow: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const start = vi.fn().mockResolvedValue(undefined);
  const beginAuthorizationWindow = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);

  return {
    instance: {
      setAuthService: vi.fn(),
      start,
      beginAuthorizationWindow,
      stop,
    } as unknown as CodexAuthCallbackServer,
    beginAuthorizationWindow,
    stop,
  };
}
