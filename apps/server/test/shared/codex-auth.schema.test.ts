import {
  CodexAuthLoginUrlResponseSchema,
  CodexAuthRefreshResponseSchema,
  CodexAuthStatusResponseSchema,
} from "@kagami/shared";
import { describe, expect, it } from "vitest";

describe("codex auth schemas", () => {
  it("should parse auth status responses", () => {
    const result = CodexAuthStatusResponseSchema.parse({
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
    });

    expect(result.session?.provider).toBe("openai-codex");
  });

  it("should parse login url responses", () => {
    const result = CodexAuthLoginUrlResponseSchema.parse({
      loginUrl: "https://auth.openai.com/oauth/authorize?foo=bar",
      expiresAt: "2026-03-20T00:10:00.000Z",
    });

    expect(result.loginUrl).toContain("https://auth.openai.com/oauth/authorize");
  });

  it("should parse refresh responses", () => {
    const result = CodexAuthRefreshResponseSchema.parse({
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
    });

    expect(result.success).toBe(true);
  });
});
