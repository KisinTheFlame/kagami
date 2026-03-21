import {
  ClaudeCodeAuthLoginUrlResponseSchema,
  ClaudeCodeAuthRefreshResponseSchema,
  ClaudeCodeAuthStatusResponseSchema,
} from "@kagami/shared";
import { describe, expect, it } from "vitest";

describe("claude code auth schemas", () => {
  it("should parse auth status responses", () => {
    const result = ClaudeCodeAuthStatusResponseSchema.parse({
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
    });

    expect(result.session?.provider).toBe("claude-code");
  });

  it("should parse login url responses", () => {
    const result = ClaudeCodeAuthLoginUrlResponseSchema.parse({
      loginUrl: "https://claude.ai/oauth/authorize?foo=bar",
      expiresAt: "2026-03-20T00:10:00.000Z",
    });

    expect(result.loginUrl).toContain("https://claude.ai/oauth/authorize");
  });

  it("should parse refresh responses", () => {
    const result = ClaudeCodeAuthRefreshResponseSchema.parse({
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
    });

    expect(result.success).toBe(true);
  });
});
