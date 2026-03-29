import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeAuthRefreshScheduler } from "../../src/auth/application/claude-code-auth-refresh.scheduler.js";
import type { ClaudeCodeAuthService } from "../../src/auth/application/claude-code-auth.service.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ClaudeCodeAuthRefreshScheduler", () => {
  it("should refresh immediately when the session is within the refresh leeway window", async () => {
    vi.useFakeTimers();
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
    const service = createClaudeCodeAuthService({
      getStatus: vi
        .fn()
        .mockResolvedValueOnce(
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
        )
        .mockResolvedValue(
          createStatus({
            status: "active",
            session: {
              provider: "claude-code",
              accountId: "user_123",
              email: "claude@example.com",
              expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
              lastRefreshAt: new Date().toISOString(),
              lastError: null,
            },
          }),
        ),
      refresh,
    });
    const scheduler = new ClaudeCodeAuthRefreshScheduler({
      claudeCodeAuthService: service,
      refreshCheckIntervalMs: 60_000,
      refreshLeewayMs: 60_000,
    });

    scheduler.start();
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.close();
  });

  it("should skip refresh when the session is not close to expiring", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = new ClaudeCodeAuthRefreshScheduler({
      claudeCodeAuthService: createClaudeCodeAuthService({
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
      refreshCheckIntervalMs: 60_000,
      refreshLeewayMs: 60_000,
    });

    scheduler.start();
    await flushMicrotasks();

    expect(refresh).not.toHaveBeenCalled();
    scheduler.close();
  });

  it("should not start a second refresh while the previous refresh is still in flight", async () => {
    vi.useFakeTimers();
    let resolveRefresh!: () => void;
    const refresh = vi.fn().mockImplementation(async () => {
      await new Promise<void>(resolve => {
        resolveRefresh = resolve;
      });
      return {
        provider: "claude-code",
        success: true as const,
        status: "active" as const,
        session: {
          provider: "claude-code",
          accountId: "user_123",
          email: "claude@example.com",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          lastRefreshAt: new Date().toISOString(),
          lastError: null,
        },
      };
    });
    const scheduler = new ClaudeCodeAuthRefreshScheduler({
      claudeCodeAuthService: createClaudeCodeAuthService({
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
      }),
      refreshCheckIntervalMs: 60_000,
      refreshLeewayMs: 60_000,
    });

    scheduler.start();
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRefresh();
    await flushMicrotasks();
    scheduler.close();
  });
});

function createClaudeCodeAuthService(
  overrides?: Partial<ClaudeCodeAuthService>,
): ClaudeCodeAuthService {
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

function createStatus(
  overrides?: Partial<Awaited<ReturnType<ClaudeCodeAuthService["getStatus"]>>>,
) {
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
