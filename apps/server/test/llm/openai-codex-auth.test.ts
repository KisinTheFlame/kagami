import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCodexAuthStore } from "../../src/llm/providers/openai-codex-auth.js";

afterEach(async () => {
  vi.restoreAllMocks();
});

describe("OpenAiCodexAuthStore", () => {
  it("should delegate to codex auth service", async () => {
    const codexAuthService = {
      hasCredentials: vi.fn().mockResolvedValue(true),
      getAuth: vi.fn().mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        idToken: "id-token",
        accountId: "account-id",
        email: "bot@example.com",
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

    const store = new OpenAiCodexAuthStore({
      codexAuthService,
    });

    await expect(store.hasCredentials()).resolves.toBe(true);
    await expect(store.getAuth()).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      accountId: "account-id",
      email: "bot@example.com",
    });
    expect(codexAuthService.hasCredentials).toHaveBeenCalledTimes(1);
    expect(codexAuthService.getAuth).toHaveBeenCalledTimes(1);
  });
});
