import { describe, expect, it, vi } from "vitest";
import { ClaudeCodeAuthStore } from "../../src/llm/providers/claude-code-auth.js";

describe("ClaudeCodeAuthStore", () => {
  it("should delegate credential checks and auth loading to the auth service", async () => {
    const service = {
      hasCredentials: vi.fn().mockResolvedValue(true),
      getAuth: vi.fn().mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        lastRefresh: "2026-03-20T00:00:00.000Z",
        expiresAt: Date.now() + 60_000,
      }),
      getStatus: vi.fn(),
      createLoginUrl: vi.fn(),
      handleCallback: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
      getUsageLimits: vi.fn(),
      getAuthWithoutRefresh: vi.fn(),
    };

    const store = new ClaudeCodeAuthStore({
      claudeCodeAuthService: service,
    });

    await expect(store.hasCredentials()).resolves.toBe(true);
    await expect(store.getAuth()).resolves.toMatchObject({
      accessToken: "access-token",
    });
    expect(service.hasCredentials).toHaveBeenCalledTimes(1);
    expect(service.getAuth).toHaveBeenCalledWith(undefined);
  });
});
