import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexAuthHandler } from "../../src/handler/codex-auth.handler.js";
import type { CodexAuthService } from "../../src/service/codex-auth.service.js";

describe("CodexAuthHandler", () => {
  let app = Fastify({ logger: false });

  beforeEach(() => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it("should expose auth management endpoints", async () => {
    const codexAuthService: CodexAuthService = {
      getStatus: vi.fn().mockResolvedValue({
        status: "active",
        isLoggedIn: true,
        session: {
          provider: "openai-codex",
          accountId: "acct_123",
          email: "bot@example.com",
          expiresAt: "2026-03-20T00:00:00.000Z",
          lastRefreshAt: "2026-03-20T00:00:00.000Z",
          lastError: null,
        },
      }),
      createLoginUrl: vi.fn().mockResolvedValue({
        loginUrl: "https://auth.openai.com/oauth/authorize?foo=bar",
        expiresAt: "2026-03-20T00:10:00.000Z",
      }),
      handleCallback: vi.fn().mockResolvedValue({
        redirectUrl: "http://localhost:20004/auth/codex?result=success",
      }),
      logout: vi.fn().mockResolvedValue({
        success: true,
        status: "logged_out",
      }),
      refresh: vi.fn().mockResolvedValue({
        success: true,
        status: "active",
        session: {
          provider: "openai-codex",
          accountId: "acct_123",
          email: "bot@example.com",
          expiresAt: "2026-03-20T01:00:00.000Z",
          lastRefreshAt: "2026-03-20T00:30:00.000Z",
          lastError: null,
        },
      }),
      getUsageLimits: vi.fn().mockResolvedValue({
        primary: {
          usedPercent: 44,
          windowDurationMins: 300,
          resetsAt: 1_774_400_000_000,
        },
        secondary: null,
      }),
      hasCredentials: vi.fn(),
      getAuth: vi.fn(),
    };

    new CodexAuthHandler({ codexAuthService }).register(app);

    const statusResponse = await app.inject({
      method: "GET",
      url: "/codex-auth/status",
    });
    expect(statusResponse.statusCode).toBe(200);

    const loginUrlResponse = await app.inject({
      method: "POST",
      url: "/codex-auth/login-url",
      payload: {},
    });
    expect(loginUrlResponse.statusCode).toBe(200);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/codex-auth/logout",
      payload: {},
    });
    expect(logoutResponse.statusCode).toBe(200);

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/codex-auth/refresh",
      payload: {},
    });
    expect(refreshResponse.statusCode).toBe(200);

    const usageLimitsResponse = await app.inject({
      method: "GET",
      url: "/codex-auth/usage-limits",
    });
    expect(usageLimitsResponse.statusCode).toBe(200);

    const callbackResponse = await app.inject({
      method: "GET",
      url: "/codex-auth/callback?code=code-123&state=state-123",
    });
    expect(callbackResponse.statusCode).toBe(302);
    expect(callbackResponse.headers.location).toBe(
      "http://localhost:20004/auth/codex?result=success",
    );
  });
});
