import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeCodeAuthHandler } from "../../src/handler/claude-code-auth.handler.js";
import type { AuthUsageTrendQueryService } from "../../src/service/auth-usage-trend-query.service.js";
import type { ClaudeCodeAuthService } from "../../src/service/claude-code-auth.service.js";

describe("ClaudeCodeAuthHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should expose auth management endpoints", async () => {
    const claudeCodeAuthService: ClaudeCodeAuthService = {
      getStatus: vi.fn().mockResolvedValue({
        status: "active",
        isLoggedIn: true,
        session: {
          provider: "claude-code",
          accountId: "user_123",
          email: "bot@example.com",
          expiresAt: "2026-03-20T00:00:00.000Z",
          lastRefreshAt: "2026-03-20T00:00:00.000Z",
          lastError: null,
        },
      }),
      createLoginUrl: vi.fn().mockResolvedValue({
        loginUrl: "https://claude.ai/oauth/authorize?foo=bar",
        expiresAt: "2026-03-20T00:10:00.000Z",
      }),
      handleCallback: vi.fn().mockResolvedValue({
        redirectUrl: "http://localhost:20004/auth/claude-code?result=success",
      }),
      logout: vi.fn().mockResolvedValue({
        success: true,
        status: "logged_out",
      }),
      refresh: vi.fn().mockResolvedValue({
        success: true,
        status: "active",
        session: {
          provider: "claude-code",
          accountId: "user_123",
          email: "bot@example.com",
          expiresAt: "2026-03-20T01:00:00.000Z",
          lastRefreshAt: "2026-03-20T00:30:00.000Z",
          lastError: null,
        },
      }),
      getUsageLimits: vi.fn().mockResolvedValue({
        five_hour: {
          utilization: 32,
          resets_at: "2026-03-20T03:00:00.000Z",
        },
        seven_day: null,
        extra_usage: null,
      }),
      hasCredentials: vi.fn(),
      getAuthWithoutRefresh: vi.fn(),
      getAuth: vi.fn(),
    };
    const authUsageTrendQueryService: AuthUsageTrendQueryService = {
      query: vi.fn().mockResolvedValue({
        range: "24h",
        series: [
          {
            windowKey: "five_hour",
            label: "5 小时",
            points: [],
          },
          {
            windowKey: "seven_day",
            label: "7 天",
            points: [],
          },
        ],
      }),
    };

    new ClaudeCodeAuthHandler({
      claudeCodeAuthService,
      authUsageTrendQueryService,
    }).register(app);

    const statusResponse = await app.inject({
      method: "GET",
      url: "/claude-code-auth/status",
    });
    expect(statusResponse.statusCode).toBe(200);

    const loginUrlResponse = await app.inject({
      method: "POST",
      url: "/claude-code-auth/login-url",
      payload: {},
    });
    expect(loginUrlResponse.statusCode).toBe(200);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/claude-code-auth/logout",
      payload: {},
    });
    expect(logoutResponse.statusCode).toBe(200);

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/claude-code-auth/refresh",
      payload: {},
    });
    expect(refreshResponse.statusCode).toBe(200);

    const usageLimitsResponse = await app.inject({
      method: "GET",
      url: "/claude-code-auth/usage-limits",
    });
    expect(usageLimitsResponse.statusCode).toBe(200);

    const usageTrendResponse = await app.inject({
      method: "GET",
      url: "/claude-code-auth/usage-trend?range=24h",
    });
    expect(usageTrendResponse.statusCode).toBe(200);
    expect(authUsageTrendQueryService.query).toHaveBeenCalledWith({
      provider: "claude-code",
      accountId: "user_123",
      range: "24h",
    });

    const callbackResponse = await app.inject({
      method: "GET",
      url: "/claude-code-auth/callback?code=code-123&state=state-123",
    });
    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe(
      "http://localhost:20004/auth/claude-code?result=success",
    );
  });
});
