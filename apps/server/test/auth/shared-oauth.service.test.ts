import { describe, expect, it, vi } from "vitest";
import { SharedOAuthServiceCore } from "../../src/auth/shared/service.js";
import type {
  OAuthDao,
  OAuthProviderAuth,
  OAuthRuntimeConfig,
  OAuthSecretStore,
  OAuthSessionRecord,
  OAuthStateRecord,
  OAuthTokenResponse,
} from "../../src/auth/shared/types.js";

type TestSessionRecord = OAuthSessionRecord<"test-provider">;

type TestStateRecord = OAuthStateRecord;

const baseConfig: OAuthRuntimeConfig = {
  enabled: true,
  publicBaseUrl: "http://localhost:20004",
  oauthRedirectPath: "/callback",
  oauthStateTtlMs: 600_000,
  refreshLeewayMs: 60_000,
  timeoutMs: 5_000,
};

describe("SharedOAuthServiceCore", () => {
  it("should dedupe concurrent refresh calls", async () => {
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
      findSession: vi.fn().mockResolvedValue(
        createSession({
          accessToken: "encoded-stale-access",
          refreshToken: "encoded-stale-refresh",
          expiresAt: new Date(Date.now() + 5_000),
        }),
      ),
      upsertSession,
    });
    const refreshTokens = vi.fn(
      async (): Promise<OAuthTokenResponse> => ({
        accessToken: "fresh-access",
        refreshToken: "fresh-refresh",
        expiresAt: new Date(Date.now() + 60_000),
        lastRefreshAt: new Date("2026-03-20T00:00:00.000Z"),
      }),
    );
    const core = createCore({
      dao,
      secretStore: {
        encode: vi.fn(async value => `encoded-${value}`),
        decode: vi.fn(async value => value.replace(/^encoded-/, "")),
      },
      refreshTokens,
    });

    const [first, second] = await Promise.all([core.getAuth(), core.getAuth()]);

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(upsertSession).toHaveBeenCalledTimes(1);
    expect(first.accessToken).toBe("fresh-access");
    expect(second.accessToken).toBe("fresh-access");
  });

  it("should return an error redirect when oauth state was already used", async () => {
    const core = createCore({
      dao: createDao({
        findOAuthState: vi.fn().mockResolvedValue(
          createOAuthState({
            usedAt: new Date("2026-03-20T00:00:00.000Z"),
          }),
        ),
      }),
    });

    const result = await core.handleCallback({
      code: "code-123",
      state: "state-123",
    });

    expect(result.redirectUrl).toContain("/auth?result=error");
    expect(result.redirectUrl).toContain(encodeURIComponent("登录回调已被处理"));
  });

  it("should keep an active status and record the refresh error when automatic refresh fails", async () => {
    const expiringSession = createSession({
      expiresAt: new Date(Date.now() + 5_000),
      accessToken: "encoded-stale-access",
      refreshToken: "encoded-stale-refresh",
    });
    const upsertSession = vi.fn(async input =>
      createSession({
        ...expiringSession,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        expiresAt: input.expiresAt,
        lastRefreshAt: input.lastRefreshAt,
        status: input.status,
        lastError: input.lastError,
      }),
    );
    const core = createCore({
      dao: createDao({
        findSession: vi.fn().mockResolvedValue(expiringSession),
        upsertSession,
      }),
      secretStore: {
        encode: vi.fn(async value => `encoded-${value}`),
        decode: vi.fn(async value => value.replace(/^encoded-/, "")),
      },
      refreshTokens: vi.fn(async () => {
        throw new Error("refresh failed");
      }),
    });

    await expect(core.getAuth()).rejects.toMatchObject({
      message: "Test OAuth 登录状态不可用",
    });
    expect(upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        lastError: "refresh failed",
      }),
    );
  });

  it("should normalize refresh_failed sessions to an available status in getStatus", async () => {
    const core = createCore({
      dao: createDao({
        findSession: vi.fn().mockResolvedValue(
          createSession({
            status: "refresh_failed",
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          }),
        ),
        upsertSession: vi.fn(async input =>
          createSession({
            status: input.status,
            lastError: input.lastError,
            expiresAt: input.expiresAt,
          }),
        ),
      }),
    });

    await expect(core.getStatus()).resolves.toMatchObject({
      status: "active",
      isLoggedIn: true,
    });
  });

  it("should return the current active auth without refreshing when automatic refresh on getAuth is disabled", async () => {
    const refreshTokens = vi.fn();
    const core = createCore({
      autoRefreshOnGetAuth: false,
      dao: createDao({
        findSession: vi.fn().mockResolvedValue(
          createSession({
            accessToken: "encoded-active-access",
            refreshToken: "encoded-active-refresh",
            expiresAt: new Date(Date.now() + 5_000),
          }),
        ),
      }),
      secretStore: {
        encode: vi.fn(async value => `encoded-${value}`),
        decode: vi.fn(async value => value.replace(/^encoded-/, "")),
      },
      refreshTokens,
    });

    await expect(core.getAuth()).resolves.toMatchObject({
      accessToken: "active-access",
      refreshToken: "active-refresh",
    });
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("should reject expired auth reads when automatic refresh on getAuth is disabled", async () => {
    const refreshTokens = vi.fn();
    const core = createCore({
      autoRefreshOnGetAuth: false,
      dao: createDao({
        findSession: vi.fn().mockResolvedValue(
          createSession({
            accessToken: "encoded-expired-access",
            refreshToken: "encoded-expired-refresh",
            expiresAt: new Date(Date.now() - 5_000),
          }),
        ),
      }),
      secretStore: {
        encode: vi.fn(async value => `encoded-${value}`),
        decode: vi.fn(async value => value.replace(/^encoded-/, "")),
      },
      refreshTokens,
    });

    await expect(core.getAuth()).rejects.toMatchObject({
      message: "Test OAuth 登录状态不可用",
    });
    expect(refreshTokens).not.toHaveBeenCalled();
  });
});

function createCore(input?: {
  dao?: OAuthDao<"test-provider", TestSessionRecord, TestStateRecord>;
  secretStore?: OAuthSecretStore;
  autoRefreshOnGetAuth?: boolean;
  refreshTokens?: (input: {
    refreshToken: string;
    config: OAuthRuntimeConfig;
  }) => Promise<OAuthTokenResponse>;
}) {
  return new SharedOAuthServiceCore({
    dao: input?.dao ?? createDao(),
    config: baseConfig,
    callbackServer: {
      beginAuthorizationWindow: vi.fn(),
      stop: vi.fn(),
    },
    secretStore:
      input?.secretStore ??
      ({
        encode: vi.fn(async value => value),
        decode: vi.fn(async value => value),
      } satisfies OAuthSecretStore),
    providerId: "test-provider",
    displayName: "Test OAuth",
    managementPath: "/auth",
    autoRefreshOnGetAuth: input?.autoRefreshOnGetAuth,
    protocolAdapter: {
      buildAuthorizeUrl: ({ redirectUri, state }) =>
        `https://example.com/oauth?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
      exchangeCodeForTokens: vi.fn(
        async (): Promise<OAuthTokenResponse> => ({
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: new Date(Date.now() + 60_000),
          lastRefreshAt: new Date("2026-03-20T00:00:00.000Z"),
        }),
      ),
      refreshTokens:
        input?.refreshTokens ??
        vi.fn(
          async (): Promise<OAuthTokenResponse> => ({
            accessToken: "next-access",
            refreshToken: "next-refresh",
            expiresAt: new Date(Date.now() + 60_000),
            lastRefreshAt: new Date("2026-03-20T00:00:00.000Z"),
          }),
        ),
      getRedirectUri: oauthRedirectPath => `http://localhost:54545${oauthRedirectPath}`,
    },
    toStatusResponse: session => ({
      status: session?.status ?? "unavailable",
      isLoggedIn: session?.status === "active" || session?.status === "expired",
      session: session
        ? {
            provider: session.provider,
            accountId: session.accountId,
            email: session.email,
            expiresAt: session.expiresAt?.toISOString() ?? null,
            lastRefreshAt: session.lastRefreshAt?.toISOString() ?? null,
            lastError: session.lastError,
          }
        : null,
    }),
    toRefreshResponse: session => ({
      success: true as const,
      status: "active" as const,
      session: {
        provider: session.provider,
        accountId: session.accountId,
        email: session.email,
        expiresAt: session.expiresAt?.toISOString() ?? null,
        lastRefreshAt: session.lastRefreshAt?.toISOString() ?? null,
        lastError: session.lastError,
      },
    }),
    toProviderAuth: ({ session, accessToken, refreshToken, idToken }) =>
      ({
        accessToken,
        refreshToken,
        ...(idToken ? { idToken } : {}),
        ...(session.accountId ? { accountId: session.accountId } : {}),
        ...(session.email ? { email: session.email } : {}),
        lastRefresh: session.lastRefreshAt?.toISOString() ?? new Date(0).toISOString(),
        expiresAt: session.expiresAt?.getTime() ?? 0,
      }) satisfies OAuthProviderAuth,
  });
}

function createDao(
  overrides?: Partial<OAuthDao<"test-provider", TestSessionRecord, TestStateRecord>>,
): OAuthDao<"test-provider", TestSessionRecord, TestStateRecord> {
  return {
    findSession: vi.fn().mockResolvedValue(null),
    upsertSession: vi.fn(async input =>
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
    ),
    createOAuthState: vi.fn(async input => createOAuthState(input)),
    findOAuthState: vi.fn().mockResolvedValue(null),
    markOAuthStateUsed: vi.fn(),
    deleteExpiredOAuthStates: vi.fn(),
    ...overrides,
  };
}

function createSession(overrides?: Partial<TestSessionRecord>): TestSessionRecord {
  return {
    id: 1,
    provider: "test-provider",
    accountId: "acct_123",
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

function createOAuthState(overrides?: Partial<TestStateRecord>): TestStateRecord {
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
