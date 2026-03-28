import {
  ClaudeCodeAuthLoginUrlResponseSchema,
  ClaudeCodeAuthRefreshResponseSchema,
  ClaudeCodeAuthStatusResponseSchema,
  ClaudeCodeUsageLimitsResponseSchema,
} from "@kagami/shared";
import { describe, expect, it } from "vitest";

describe("claude code auth schemas", () => {
  it("should parse auth status responses", () => {
    const result = ClaudeCodeAuthStatusResponseSchema.parse({
      provider: "claude-code",
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
      provider: "claude-code",
      loginUrl: "https://claude.ai/oauth/authorize?foo=bar",
      expiresAt: "2026-03-20T00:10:00.000Z",
    });

    expect(result.loginUrl).toContain("https://claude.ai/oauth/authorize");
  });

  it("should parse refresh responses", () => {
    const result = ClaudeCodeAuthRefreshResponseSchema.parse({
      provider: "claude-code",
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

  it("should parse usage limit responses", () => {
    const result = ClaudeCodeUsageLimitsResponseSchema.parse({
      five_hour: {
        utilization: 42,
        resets_at: "2026-03-25T12:00:00.000+00:00",
      },
      seven_day: {
        utilization: 61,
        resets_at: null,
      },
      extra_usage: {
        is_enabled: true,
        monthly_limit: 100,
        used_credits: 12.5,
        utilization: 12.5,
      },
    });

    expect(result.five_hour?.utilization).toBe(42);
    expect(result.extra_usage?.is_enabled).toBe(true);
  });

  it("should parse disabled extra usage responses from Anthropic", () => {
    const result = ClaudeCodeUsageLimitsResponseSchema.parse({
      five_hour: {
        utilization: 0,
        resets_at: "2026-03-25T12:00:00.000+00:00",
      },
      seven_day: {
        utilization: 4,
        resets_at: "2026-03-28T14:00:00.377349+00:00",
      },
      extra_usage: {
        is_enabled: false,
        monthly_limit: null,
        used_credits: null,
        utilization: null,
      },
    });

    expect(result.extra_usage).toEqual({
      is_enabled: false,
      monthly_limit: null,
      used_credits: null,
      utilization: null,
    });
  });

  it("should parse empty usage limit responses", () => {
    const result = ClaudeCodeUsageLimitsResponseSchema.parse({
      five_hour: null,
      seven_day: null,
      extra_usage: null,
    });

    expect(result).toEqual({
      five_hour: null,
      seven_day: null,
      extra_usage: null,
    });
  });
});
