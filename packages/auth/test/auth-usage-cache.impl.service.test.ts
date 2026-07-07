import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ClaudeCodeUsageLimitsResponse } from "@kagami/llm-api/claude-code-auth";
import { type CodexUsageLimitsResponse } from "@kagami/llm-api/codex-auth";
import { BizError } from "@kagami/kernel/errors/biz-error";
import {
  AuthUsageCacheManager,
  EMPTY_CLAUDE_CODE_USAGE_LIMITS,
  EMPTY_CODEX_USAGE_LIMITS,
  fetchClaudeCodeUsageLimitsFromApi,
  fetchCodexUsageLimitsViaAppServer,
} from "../src/application/auth-usage-cache.impl.service.js";
import type { ClaudeCodeAuthService } from "../src/application/claude-code-auth.service.js";
import type { CodexAuthService } from "../src/application/codex-auth.service.js";
import type { AuthUsageSnapshotSink } from "../src/application/auth-usage-snapshot-sink.js";
import { initTestLogger } from "./helpers/logger.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("AuthUsageCacheManager", () => {
  it("refreshAll populates both caches and records snapshots", async () => {
    const claudeFetch = vi.fn().mockResolvedValue({
      five_hour: {
        utilization: 25,
        resets_at: "2026-03-25T12:00:00.000Z",
      },
      seven_day: null,
      extra_usage: null,
    } satisfies ClaudeCodeUsageLimitsResponse);
    const codexFetch = vi.fn().mockResolvedValue({
      primary: {
        usedPercent: 44,
        windowDurationMins: 300,
        resetsAt: 1_774_400_000_000,
      },
      secondary: null,
    } satisfies CodexUsageLimitsResponse);

    const claudeCodeAuthService = createClaudeCodeAuthService();
    const codexAuthService = createCodexAuthService();
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService,
      codexAuthService,
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: claudeFetch,
      fetchCodexUsageLimits: codexFetch,
    });

    await manager.refreshAll();

    expect(await manager.getClaudeCodeUsageLimits()).toEqual(
      expect.objectContaining({
        five_hour: expect.objectContaining({
          utilization: 25,
        }),
      }),
    );
    expect(await manager.getCodexUsageLimits()).toEqual(
      expect.objectContaining({
        primary: expect.objectContaining({
          usedPercent: 44,
        }),
      }),
    );
    expect(claudeFetch).toHaveBeenCalledTimes(1);
    expect(codexFetch).toHaveBeenCalledTimes(1);
    expect(claudeCodeAuthService.getStatus).toHaveBeenCalledTimes(1);
    expect(claudeCodeAuthService.getAuthWithoutRefresh).toHaveBeenCalledTimes(1);
    expect(claudeCodeAuthService.getAuth).not.toHaveBeenCalled();
    expect(codexAuthService.getAuthWithoutRefresh).toHaveBeenCalledTimes(1);
  });

  it("should keep the last successful cache when a refresh fails", async () => {
    const claudeFetch = vi
      .fn()
      .mockResolvedValueOnce({
        five_hour: {
          utilization: 19,
          resets_at: "2026-03-25T12:00:00.000Z",
        },
        seven_day: null,
        extra_usage: null,
      } satisfies ClaudeCodeUsageLimitsResponse)
      .mockRejectedValueOnce(new Error("upstream error"));

    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService(),
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: claudeFetch,
      fetchCodexUsageLimits: vi.fn(),
    });

    await manager.refreshAll();
    expect(await manager.getClaudeCodeUsageLimits()).toEqual(
      expect.objectContaining({
        five_hour: expect.objectContaining({
          utilization: 19,
        }),
      }),
    );

    await manager.refreshAll();
    expect(await manager.getClaudeCodeUsageLimits()).toEqual(
      expect.objectContaining({
        five_hour: expect.objectContaining({
          utilization: 19,
        }),
      }),
    );
  });

  it("keeps the last successful Claude cache when auth becomes expired but creds remain (transient)", async () => {
    // 卡片韧性（epic #521）：expired 是 token 刷新窗口的瞬时态，凭据还在 → 保留上次好值，不清空。
    const claudeCodeAuthService = createClaudeCodeAuthService({
      getStatus: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "claude-code",
          status: "active",
          isLoggedIn: true,
          session: {
            provider: "claude-code",
            accountId: "user_123",
            email: "claude@example.com",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            lastRefreshAt: "2026-03-25T00:00:00.000Z",
            lastError: null,
          },
        })
        .mockResolvedValueOnce({
          provider: "claude-code",
          status: "expired",
          isLoggedIn: true,
          session: {
            provider: "claude-code",
            accountId: "user_123",
            email: "claude@example.com",
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
            lastRefreshAt: "2026-03-25T00:00:00.000Z",
            lastError: "expired",
          },
        }),
      // 凭据仍在 = 瞬时态。
      hasCredentials: vi.fn().mockResolvedValue(true),
    });
    const claudeFetch = vi.fn().mockResolvedValue({
      five_hour: {
        utilization: 19,
        resets_at: "2026-03-25T12:00:00.000Z",
      },
      seven_day: null,
      extra_usage: null,
    } satisfies ClaudeCodeUsageLimitsResponse);

    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService,
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: claudeFetch,
      fetchCodexUsageLimits: vi.fn(),
    });

    await manager.refreshAll();
    expect(await manager.getClaudeCodeUsageLimits()).toEqual(
      expect.objectContaining({
        five_hour: expect.objectContaining({ utilization: 19 }),
      }),
    );

    await manager.refreshAll();
    // 保留上次好值（不再冲成 EMPTY）。
    expect(await manager.getClaudeCodeUsageLimits()).toEqual(
      expect.objectContaining({
        five_hour: expect.objectContaining({ utilization: 19 }),
      }),
    );
  });

  it("clears the Claude cache on explicit logout (no credentials)", async () => {
    const claudeCodeAuthService = createClaudeCodeAuthService({
      getStatus: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "claude-code",
          status: "active",
          isLoggedIn: true,
          session: {
            provider: "claude-code",
            accountId: "user_123",
            email: "claude@example.com",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            lastRefreshAt: "2026-03-25T00:00:00.000Z",
            lastError: null,
          },
        })
        .mockResolvedValueOnce({
          provider: "claude-code",
          status: "logged_out",
          isLoggedIn: false,
          session: null,
        }),
      // 登出 = 凭据已删。
      hasCredentials: vi.fn().mockResolvedValue(false),
    });
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService,
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: vi.fn().mockResolvedValue({
        five_hour: {
          utilization: 19,
          resets_at: "2026-03-25T12:00:00.000Z",
        },
        seven_day: null,
        extra_usage: null,
      } satisfies ClaudeCodeUsageLimitsResponse),
      fetchCodexUsageLimits: vi.fn(),
    });

    await manager.refreshAll();
    expect(manager.getClaudeCodeUsageCapturedAt()).not.toBeNull();

    await manager.refreshAll();
    expect(await manager.getClaudeCodeUsageLimits()).toEqual(EMPTY_CLAUDE_CODE_USAGE_LIMITS);
    expect(manager.getClaudeCodeUsageCapturedAt()).toBeNull();
  });

  it("keeps the last successful Codex cache on a transient auth read failure (creds remain)", async () => {
    const getAuthWithoutRefresh = vi
      .fn()
      .mockResolvedValueOnce({
        accessToken: "codex-access-token",
        refreshToken: "codex-refresh-token",
        idToken: "codex-id-token",
        accountId: "acct_123",
        email: "codex@example.com",
        lastRefresh: "2026-03-25T00:00:00.000Z",
        expiresAt: Date.now() + 60_000,
      })
      .mockRejectedValueOnce(new Error("transient read error"));
    const codexFetch = vi.fn().mockResolvedValue({
      primary: {
        usedPercent: 50,
        windowDurationMins: 300,
        resetsAt: 1_774_400_000_000,
      },
      secondary: null,
    } satisfies CodexUsageLimitsResponse);

    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh,
        // 凭据仍在 = 瞬时态。
        hasCredentials: vi.fn().mockResolvedValue(true),
      }),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: vi.fn(),
      fetchCodexUsageLimits: codexFetch,
    });

    await manager.refreshAll();
    expect(await manager.getCodexUsageLimits()).toEqual(
      expect.objectContaining({
        primary: expect.objectContaining({ usedPercent: 50 }),
      }),
    );

    await manager.refreshAll();
    // 瞬时读取失败保留上次好值。
    expect(await manager.getCodexUsageLimits()).toEqual(
      expect.objectContaining({
        primary: expect.objectContaining({ usedPercent: 50 }),
      }),
    );
  });

  it("clears the Codex cache on explicit logout (no credentials)", async () => {
    const getAuthWithoutRefresh = vi
      .fn()
      .mockResolvedValueOnce({
        accessToken: "codex-access-token",
        refreshToken: "codex-refresh-token",
        idToken: "codex-id-token",
        accountId: "acct_123",
        email: "codex@example.com",
        lastRefresh: "2026-03-25T00:00:00.000Z",
        expiresAt: Date.now() + 60_000,
      })
      .mockRejectedValueOnce(new Error("missing auth"));

    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh,
        hasCredentials: vi.fn().mockResolvedValue(false),
      }),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: vi.fn(),
      fetchCodexUsageLimits: vi.fn().mockResolvedValue({
        primary: {
          usedPercent: 50,
          windowDurationMins: 300,
          resetsAt: 1_774_400_000_000,
        },
        secondary: null,
      } satisfies CodexUsageLimitsResponse),
    });

    await manager.refreshAll();
    expect(manager.getCodexUsageCapturedAt()).not.toBeNull();

    await manager.refreshAll();
    expect(await manager.getCodexUsageLimits()).toEqual(EMPTY_CODEX_USAGE_LIMITS);
    expect(manager.getCodexUsageCapturedAt()).toBeNull();
  });

  it("clearClaudeCodeUsage empties the cache immediately (logout endpoint path)", async () => {
    // 登出路由直调 clearClaudeCodeUsage()，不等下一轮后台刷新即撤卡。
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService(),
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: vi.fn().mockResolvedValue({
        five_hour: { utilization: 19, resets_at: "2026-03-25T12:00:00.000Z" },
        seven_day: null,
        extra_usage: null,
      } satisfies ClaudeCodeUsageLimitsResponse),
      fetchCodexUsageLimits: vi.fn(),
    });

    await manager.refreshAll();
    expect(manager.getClaudeCodeUsageCapturedAt()).not.toBeNull();

    manager.clearClaudeCodeUsage();

    expect(await manager.getClaudeCodeUsageLimits()).toEqual(EMPTY_CLAUDE_CODE_USAGE_LIMITS);
    expect(manager.getClaudeCodeUsageCapturedAt()).toBeNull();
  });

  it("should log structured Claude Code refresh failures", async () => {
    const logs = initTestLogger();
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService(),
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: vi.fn().mockRejectedValue(
        new BizError({
          message: "Claude Code 登录服务调用失败",
          meta: {
            reason: "AUTH_REFRESH_UNAVAILABLE",
            status: 503,
          },
          cause: {
            detail: "upstream unavailable",
          },
        }),
      ),
      fetchCodexUsageLimits: vi.fn(),
    });

    await manager.refreshAll();

    expect(logs).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Failed to refresh Claude Code usage limits",
        metadata: expect.objectContaining({
          event: "auth_usage_cache.claude_code_refresh_failed",
          error: expect.objectContaining({
            name: "BizError",
            message: "Claude Code 登录服务调用失败",
            meta: {
              reason: "AUTH_REFRESH_UNAVAILABLE",
              status: 503,
            },
            cause: {
              detail: "upstream unavailable",
            },
          }),
        }),
      }),
    );
  });

  it("should log structured Codex refresh failures", async () => {
    const logs = initTestLogger();
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService({
        getStatus: vi.fn().mockResolvedValue({
          provider: "claude-code",
          status: "logged_out",
          isLoggedIn: false,
          session: null,
        }),
      }),
      codexAuthService: createCodexAuthService(),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: vi.fn(),
      fetchCodexUsageLimits: vi.fn().mockRejectedValue(
        new BizError({
          message: "Codex 登录服务调用失败",
          meta: {
            reason: "AUTH_REFRESH_FAILED",
          },
          cause: new Error("codex upstream timeout"),
        }),
      ),
    });

    await manager.refreshAll();

    expect(logs).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message: "Failed to refresh Codex usage limits",
        metadata: expect.objectContaining({
          event: "auth_usage_cache.codex_refresh_failed",
          error: expect.objectContaining({
            name: "BizError",
            message: "Codex 登录服务调用失败",
            meta: {
              reason: "AUTH_REFRESH_FAILED",
            },
            cause: expect.objectContaining({
              name: "Error",
              message: "codex upstream timeout",
            }),
          }),
        }),
      }),
    );
  });
});

describe("fetchClaudeCodeUsageLimitsFromApi", () => {
  it("should normalize Claude Code usage data from the upstream response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            five_hour: {
              utilization: 36,
              resets_at: "2026-03-25T12:00:00.000Z",
            },
            seven_day: null,
            extra_usage: {
              is_enabled: true,
              monthly_limit: 100,
              used_credits: 15.5,
              utilization: 15.5,
              currency: "USD",
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    await expect(
      fetchClaudeCodeUsageLimitsFromApi({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        lastRefresh: "2026-03-25T00:00:00.000Z",
        expiresAt: Date.now() + 60_000,
      }),
    ).resolves.toEqual({
      five_hour: {
        utilization: 36,
        resets_at: "2026-03-25T12:00:00.000Z",
      },
      seven_day: null,
      extra_usage: {
        is_enabled: true,
        monthly_limit: 100,
        used_credits: 15.5,
        utilization: 15.5,
      },
    });
  });
});

describe("fetchCodexUsageLimitsViaAppServer", () => {
  it("should use a temporary CODEX_HOME built from the Kagami auth session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "kagami-codex-binary-"));
    tempDirs.push(dir);

    const scriptPath = path.join(dir, "fake-codex.mjs");
    await writeFile(
      scriptPath,
      `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  const lines = buffer.split("\\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const message = JSON.parse(trimmed);
    if (message.id === 1) {
      process.stdout.write(JSON.stringify({ id: 1, result: { ok: true } }) + "\\n");
      continue;
    }

    if (message.id === 2) {
      const authFile = JSON.parse(
        readFileSync(path.join(process.env.CODEX_HOME ?? "", "auth.json"), "utf8"),
      );
      if (authFile.tokens.access_token !== "expected-access-token") {
        process.stdout.write(
          JSON.stringify({ id: 2, error: { message: "unexpected access token" } }) + "\\n",
        );
        continue;
      }

      process.stdout.write(
        JSON.stringify({
          id: 2,
          result: {
            rateLimits: {
              primary: {
                usedPercent: 31,
                windowDurationMins: 300,
                resetsAt: 123456,
              },
              secondary: null,
            },
          },
        }) + "\\n",
      );
    }
  }
});
`,
      "utf8",
    );
    await chmod(scriptPath, 0o755);

    await expect(
      fetchCodexUsageLimitsViaAppServer({
        binaryPath: scriptPath,
        auth: {
          accessToken: "expected-access-token",
          refreshToken: "refresh-token",
          idToken: "id-token",
          accountId: "account-id",
          email: "bot@example.com",
          lastRefresh: "2026-03-25T00:00:00.000Z",
          expiresAt: Date.now() + 60_000,
        },
      }),
    ).resolves.toEqual({
      primary: {
        usedPercent: 31,
        windowDurationMins: 300,
        resetsAt: 123456,
      },
      secondary: null,
    });
  });
});

describe("AuthUsageCacheManager sink emission (epic #521)", () => {
  function createSink(): AuthUsageSnapshotSink {
    return {
      record: vi.fn(),
      recordRefreshOutcome: vi.fn(),
    };
  }

  it("emits remaining_percent per window for both providers and success outcomes", async () => {
    const sink = createSink();
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService(),
      codexAuthService: createCodexAuthService(),
      codexBinaryPath: "codex",
      authUsageSnapshotSink: sink,
      fetchClaudeUsageLimits: vi.fn().mockResolvedValue({
        five_hour: { utilization: 25, resets_at: "2026-03-25T12:00:00.000Z" },
        seven_day: { utilization: 40, resets_at: "2026-03-31T12:00:00.000Z" },
        extra_usage: null,
      } satisfies ClaudeCodeUsageLimitsResponse),
      fetchCodexUsageLimits: vi.fn().mockResolvedValue({
        primary: { usedPercent: 44, windowDurationMins: 300, resetsAt: 1_774_400_000_000 },
        secondary: { usedPercent: 72, windowDurationMins: 10_080, resetsAt: 1_774_400_000_000 },
      } satisfies CodexUsageLimitsResponse),
    });

    await manager.refreshAll();

    expect(sink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        window: "five_hour",
        remainingPercent: 75,
      }),
    );
    expect(sink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        window: "seven_day",
        remainingPercent: 60,
      }),
    );
    expect(sink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-codex",
        window: "five_hour",
        remainingPercent: 56,
      }),
    );
    expect(sink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai-codex",
        window: "seven_day",
        remainingPercent: 28,
      }),
    );
    expect(sink.recordRefreshOutcome).toHaveBeenCalledWith({
      provider: "claude-code",
      success: true,
    });
    expect(sink.recordRefreshOutcome).toHaveBeenCalledWith({
      provider: "openai-codex",
      success: true,
    });
  });

  it("reports success=false when a fetch throws, and emits no remaining_percent for it", async () => {
    const sink = createSink();
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService(),
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexBinaryPath: "codex",
      authUsageSnapshotSink: sink,
      fetchClaudeUsageLimits: vi.fn().mockRejectedValue(new Error("upstream down")),
      fetchCodexUsageLimits: vi.fn(),
    });

    await manager.refreshAll();

    expect(sink.recordRefreshOutcome).toHaveBeenCalledWith({
      provider: "claude-code",
      success: false,
    });
    expect(sink.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude-code" }),
    );
  });

  it("emits remaining_percent even when accountId is missing (metric has no account dimension)", async () => {
    const sink = createSink();
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService({
        getAuthWithoutRefresh: vi.fn().mockResolvedValue({
          accessToken: "claude-access-token",
          refreshToken: "claude-refresh-token",
          accountId: undefined,
          email: "claude@example.com",
          lastRefresh: "2026-03-25T00:00:00.000Z",
          expiresAt: Date.now() + 60_000,
        }),
      }),
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexBinaryPath: "codex",
      authUsageSnapshotSink: sink,
      fetchClaudeUsageLimits: vi.fn().mockResolvedValue({
        five_hour: { utilization: 10, resets_at: "2026-03-25T12:00:00.000Z" },
        seven_day: null,
        extra_usage: null,
      } satisfies ClaudeCodeUsageLimitsResponse),
      fetchCodexUsageLimits: vi.fn(),
    });

    await manager.refreshAll();

    expect(sink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude-code",
        window: "five_hour",
        remainingPercent: 90,
      }),
    );
  });

  it("does not emit a refresh outcome when the provider is not logged in", async () => {
    const sink = createSink();
    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService({
        getStatus: vi.fn().mockResolvedValue({
          provider: "claude-code",
          status: "logged_out",
          isLoggedIn: false,
          session: null,
        }),
      }),
      codexAuthService: createCodexAuthService({
        getAuthWithoutRefresh: vi.fn().mockRejectedValue(new Error("missing auth")),
      }),
      codexBinaryPath: "codex",
      authUsageSnapshotSink: sink,
      fetchClaudeUsageLimits: vi.fn(),
      fetchCodexUsageLimits: vi.fn(),
    });

    await manager.refreshAll();

    expect(sink.recordRefreshOutcome).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude-code" }),
    );
  });
});

function createClaudeCodeAuthService(
  overrides?: Partial<ClaudeCodeAuthService>,
): ClaudeCodeAuthService {
  return {
    getStatus: vi.fn().mockResolvedValue({
      provider: "claude-code",
      status: "active",
      isLoggedIn: true,
      session: {
        provider: "claude-code",
        accountId: "user_123",
        email: "claude@example.com",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        lastRefreshAt: "2026-03-25T00:00:00.000Z",
        lastError: null,
      },
    }),
    createLoginUrl: vi.fn(),
    handleCallback: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    getUsageLimits: vi.fn().mockResolvedValue(EMPTY_CLAUDE_CODE_USAGE_LIMITS),
    hasCredentials: vi.fn().mockResolvedValue(true),
    getAuthWithoutRefresh: vi.fn().mockResolvedValue({
      accessToken: "claude-access-token",
      refreshToken: "claude-refresh-token",
      accountId: "user_123",
      email: "claude@example.com",
      lastRefresh: "2026-03-25T00:00:00.000Z",
      expiresAt: Date.now() + 60_000,
    }),
    getAuth: vi.fn().mockResolvedValue({
      accessToken: "claude-access-token",
      refreshToken: "claude-refresh-token",
      accountId: "user_123",
      email: "claude@example.com",
      lastRefresh: "2026-03-25T00:00:00.000Z",
      expiresAt: Date.now() + 60_000,
    }),
    ...overrides,
  };
}

function createCodexAuthService(overrides?: Partial<CodexAuthService>): CodexAuthService {
  return {
    getStatus: vi.fn(),
    createLoginUrl: vi.fn(),
    handleCallback: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    getUsageLimits: vi.fn().mockResolvedValue(EMPTY_CODEX_USAGE_LIMITS),
    hasCredentials: vi.fn().mockResolvedValue(true),
    getAuthWithoutRefresh: vi.fn().mockResolvedValue({
      accessToken: "codex-access-token",
      refreshToken: "codex-refresh-token",
      idToken: "codex-id-token",
      accountId: "acct_123",
      email: "codex@example.com",
      lastRefresh: "2026-03-25T00:00:00.000Z",
      expiresAt: Date.now() + 60_000,
    }),
    getAuth: vi.fn().mockResolvedValue({
      accessToken: "codex-access-token",
      refreshToken: "codex-refresh-token",
      idToken: "codex-id-token",
      accountId: "acct_123",
      email: "codex@example.com",
      lastRefresh: "2026-03-25T00:00:00.000Z",
      expiresAt: Date.now() + 60_000,
    }),
    ...overrides,
  };
}
