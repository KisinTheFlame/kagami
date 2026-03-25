import { describe, expect, it, vi } from "vitest";
import type { ClaudeCodeAuthCallbackServer } from "../../src/claude-code-auth/callback-server.js";
import { DefaultClaudeCodeAuthService } from "../../src/service/claude-code-auth.impl.service.js";
import type { ClaudeCodeAuthDao } from "../../src/dao/claude-code-auth.dao.js";
import type {
  ClaudeCodeAuthSessionRecord,
  ClaudeCodeOAuthStateRecord,
} from "../../src/claude-code-auth/types.js";

const baseConfig = {
  enabled: true,
  publicBaseUrl: "http://localhost:20004",
  oauthRedirectPath: "/callback",
  oauthStateTtlMs: 600_000,
  refreshLeewayMs: 60_000,
  timeoutMs: 5_000,
} as const;

function createDao(overrides?: Partial<ClaudeCodeAuthDao>): ClaudeCodeAuthDao {
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

function createSession(
  overrides?: Partial<ClaudeCodeAuthSessionRecord>,
): ClaudeCodeAuthSessionRecord {
  return {
    id: 1,
    provider: "claude-code",
    accountId: "user_123",
    email: "bot@example.com",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    idToken: null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    lastRefreshAt: new Date("2026-03-20T00:00:00.000Z"),
    status: "active",
    lastError: null,
    createdAt: new Date("2026-03-20T00:00:00.000Z"),
    updatedAt: new Date("2026-03-20T00:00:00.000Z"),
    ...overrides,
  };
}

function createOAuthStateRecord(
  overrides?: Partial<ClaudeCodeOAuthStateRecord>,
): ClaudeCodeOAuthStateRecord {
  return {
    id: 1,
    state: "state-123",
    codeVerifier: "verifier-123",
    redirectUri: "http://localhost:54545/callback",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DefaultClaudeCodeAuthService", () => {
  it("should return usage limits from the bound provider", async () => {
    const service = new DefaultClaudeCodeAuthService({
      claudeCodeAuthDao: createDao(),
      config: baseConfig,
      callbackServer: createCallbackServer(),
    });
    service.setUsageLimitsProvider(() => ({
      five_hour: {
        utilization: 28,
        resets_at: "2026-03-25T12:00:00.000Z",
      },
      seven_day: null,
      extra_usage: null,
    }));

    await expect(service.getUsageLimits()).resolves.toEqual({
      five_hour: {
        utilization: 28,
        resets_at: "2026-03-25T12:00:00.000Z",
      },
      seven_day: null,
      extra_usage: null,
    });
  });

  it("should create a login url and persist OAuth state", async () => {
    const createOAuthState = vi.fn(async input => ({
      id: 1,
      createdAt: new Date(),
      usedAt: null,
      ...input,
    }));
    const dao = createDao({
      createOAuthState,
    });
    const service = new DefaultClaudeCodeAuthService({
      claudeCodeAuthDao: dao,
      config: baseConfig,
      callbackServer: createCallbackServer(),
    });

    const result = await service.createLoginUrl();

    expect(result.loginUrl).toContain("https://claude.ai/oauth/authorize?");
    expect(result.loginUrl).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback");
    expect(createOAuthState).toHaveBeenCalledTimes(1);
    expect(createOAuthState.mock.calls[0]?.[0].redirectUri).toBe("http://localhost:54545/callback");
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
          expires_in: 3600,
          account: {
            uuid: "user_live",
            email_address: "claude@example.com",
          },
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

    const service = new DefaultClaudeCodeAuthService({
      claudeCodeAuthDao: dao,
      config: baseConfig,
      callbackServer: createCallbackServer(),
    });

    const result = await service.handleCallback({
      code: "code-123",
      state: oauthState.state,
    });

    expect(result.redirectUrl).toBe("http://localhost:20004/auth/claude-code?result=success");
    expect(upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        accountId: "user_live",
        email: "claude@example.com",
        status: "active",
      }),
    );
  });

  it("should reject invalid callback state by redirecting with an error", async () => {
    const service = new DefaultClaudeCodeAuthService({
      claudeCodeAuthDao: createDao(),
      config: baseConfig,
      callbackServer: createCallbackServer(),
    });

    const result = await service.handleCallback({
      code: "code-123",
      state: "missing-state",
    });

    expect(result.redirectUrl).toContain("http://localhost:20004/auth/claude-code?result=error");
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
            expires_in: 3600,
            account: {
              uuid: "user_live",
              email_address: "claude@example.com",
            },
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

    const service = new DefaultClaudeCodeAuthService({
      claudeCodeAuthDao: dao,
      config: baseConfig,
      callbackServer: createCallbackServer(),
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

  it("should preserve an available status when refresh fails and still support logout", async () => {
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

    const service = new DefaultClaudeCodeAuthService({
      claudeCodeAuthDao: dao,
      config: baseConfig,
      callbackServer: createCallbackServer(),
    });

    await expect(service.getAuth({ forceRefresh: true })).rejects.toMatchObject({
      message: "Claude Code 登录状态不可用",
    });
    expect(upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "expired",
        lastError: "Claude Code 登录当前不可用",
      }),
    );

    const logout = await service.logout();
    expect(logout).toEqual({
      success: true,
      status: "logged_out",
    });
  });

  it("should read cached auth without refreshing or mutating status", async () => {
    const session = createSession({
      status: "refresh_failed",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      accessToken: "cached-access",
      refreshToken: "cached-refresh",
    });
    const dao = createDao({
      findSession: vi.fn().mockResolvedValue(session),
      upsertSession: vi.fn(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new DefaultClaudeCodeAuthService({
      claudeCodeAuthDao: dao,
      config: baseConfig,
      callbackServer: createCallbackServer(),
    });

    await expect(service.getAuthWithoutRefresh()).resolves.toMatchObject({
      accessToken: "cached-access",
      refreshToken: "cached-refresh",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dao.upsertSession).not.toHaveBeenCalled();
  });
});

function createCallbackServer(): ClaudeCodeAuthCallbackServer {
  return {
    setAuthService: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    beginAuthorizationWindow: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as ClaudeCodeAuthCallbackServer;
}
