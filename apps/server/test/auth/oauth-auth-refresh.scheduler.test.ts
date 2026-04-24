import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthAuthRefreshScheduler } from "../../src/auth/application/oauth-auth-refresh.scheduler.js";
import { BizError } from "../../src/common/errors/biz-error.js";
import type { OAuthAuthService } from "../../src/auth/application/oauth-auth.service.js";
import { initTestLogger } from "../helpers/logger.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OAuthAuthRefreshScheduler.runOnce", () => {
  it("calls refresh when the session is within the refresh leeway window", async () => {
    const refresh = vi.fn().mockResolvedValue({
      provider: "claude-code",
      success: true,
      status: "active",
      session: {
        provider: "claude-code",
        accountId: "user_123",
        email: "claude@example.com",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastRefreshAt: new Date().toISOString(),
        lastError: null,
      },
    });
    const service = createAuthService({
      getStatus: vi.fn().mockResolvedValue(
        createStatus({
          status: "active",
          session: {
            provider: "claude-code",
            accountId: "user_123",
            email: "claude@example.com",
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
            lastRefreshAt: new Date().toISOString(),
            lastError: null,
          },
        }),
      ),
      refresh,
    });
    const scheduler = new OAuthAuthRefreshScheduler({
      authService: service,
      displayName: "Claude Code",
      logEventPrefix: "claude_code_auth_refresh_scheduler",
      refreshCheckIntervalMs: 60_000,
      refreshLeewayMs: 60_000,
    });

    await scheduler.runOnce();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("skips refresh when the session is not close to expiring", async () => {
    const refresh = vi.fn();
    const scheduler = new OAuthAuthRefreshScheduler({
      authService: createAuthService({
        getStatus: vi.fn().mockResolvedValue(
          createStatus({
            status: "active",
            session: {
              provider: "claude-code",
              accountId: "user_123",
              email: "claude@example.com",
              expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
              lastRefreshAt: new Date().toISOString(),
              lastError: null,
            },
          }),
        ),
        refresh,
      }),
      displayName: "Claude Code",
      logEventPrefix: "claude_code_auth_refresh_scheduler",
      refreshCheckIntervalMs: 60_000,
      refreshLeewayMs: 60_000,
    });

    await scheduler.runOnce();

    expect(refresh).not.toHaveBeenCalled();
  });

  it("logs structured refresh failure details with the configured event prefix", async () => {
    const logs = initTestLogger();
    const refresh = vi.fn().mockRejectedValue(
      new BizError({
        message: "Codex 登录状态不可用",
        meta: {
          provider: "openai-codex",
          reason: "AUTH_REFRESH_FAILED",
        },
        cause: new BizError({
          message: "Codex 登录当前不可用",
          meta: {
            reason: "AUTH_REFRESH_UNAVAILABLE",
            status: 401,
          },
          cause: {
            error: "invalid_grant",
          },
        }),
      }),
    );
    const scheduler = new OAuthAuthRefreshScheduler({
      authService: createAuthService({
        getStatus: vi.fn().mockResolvedValue(
          createStatus({
            provider: "codex",
            status: "expired",
            session: {
              provider: "codex",
              accountId: "user_123",
              email: "codex@example.com",
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
              lastRefreshAt: "2026-03-25T00:00:00.000Z",
              lastError: "previous refresh failed",
            },
          }),
        ),
        refresh,
      }),
      displayName: "Codex",
      logEventPrefix: "codex_auth_refresh_scheduler",
      refreshCheckIntervalMs: 60_000,
      refreshLeewayMs: 60_000,
    });

    await scheduler.runOnce();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "Failed to refresh Codex auth session",
        metadata: expect.objectContaining({
          event: "codex_auth_refresh_scheduler.refresh_failed",
          provider: "codex",
          authStatus: "expired",
          session: {
            accountId: "user_123",
            email: "codex@example.com",
            expiresAt: expect.any(String),
            lastRefreshAt: "2026-03-25T00:00:00.000Z",
            lastError: "previous refresh failed",
          },
          refreshCheckIntervalMs: 60_000,
          refreshLeewayMs: 60_000,
          error: expect.objectContaining({
            name: "BizError",
            message: "Codex 登录状态不可用",
            meta: {
              provider: "openai-codex",
              reason: "AUTH_REFRESH_FAILED",
            },
            cause: expect.objectContaining({
              name: "BizError",
              message: "Codex 登录当前不可用",
              meta: {
                reason: "AUTH_REFRESH_UNAVAILABLE",
                status: 401,
              },
              cause: {
                error: "invalid_grant",
              },
            }),
          }),
        }),
      }),
    ]);
  });
});

function createAuthService(overrides?: Partial<OAuthAuthService>): OAuthAuthService {
  return {
    getStatus: vi.fn().mockResolvedValue(createStatus()),
    createLoginUrl: vi.fn(),
    handleCallback: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn().mockResolvedValue({
      provider: "claude-code",
      success: true,
      status: "active",
      session: {
        provider: "claude-code",
        accountId: "user_123",
        email: "claude@example.com",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastRefreshAt: new Date().toISOString(),
        lastError: null,
      },
    }),
    getUsageLimits: vi.fn(),
    hasCredentials: vi.fn().mockResolvedValue(true),
    getAuthWithoutRefresh: vi.fn(),
    getAuth: vi.fn(),
    ...overrides,
  };
}

function createStatus(overrides?: Partial<Awaited<ReturnType<OAuthAuthService["getStatus"]>>>) {
  return {
    provider: "claude-code" as const,
    status: "active" as const,
    isLoggedIn: true,
    session: {
      provider: "claude-code" as const,
      accountId: "user_123",
      email: "claude@example.com",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastRefreshAt: new Date().toISOString(),
      lastError: null,
    },
    ...overrides,
  };
}
