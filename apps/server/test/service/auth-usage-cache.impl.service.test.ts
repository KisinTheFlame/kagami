import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaudeCodeUsageLimitsResponse, CodexUsageLimitsResponse } from "@kagami/shared";
import {
  AuthUsageCacheManager,
  EMPTY_CLAUDE_CODE_USAGE_LIMITS,
  EMPTY_CODEX_USAGE_LIMITS,
  fetchClaudeCodeUsageLimitsFromApi,
  fetchCodexUsageLimitsViaAppServer,
} from "../../src/service/auth-usage-cache.impl.service.js";
import type { ClaudeCodeAuthService } from "../../src/service/claude-code-auth.service.js";
import type { CodexAuthService } from "../../src/service/codex-auth.service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("AuthUsageCacheManager", () => {
  it("should refresh both caches immediately and on interval", async () => {
    vi.useFakeTimers();

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

    const manager = new AuthUsageCacheManager({
      claudeCodeAuthService: createClaudeCodeAuthService(),
      codexAuthService: createCodexAuthService(),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: claudeFetch,
      fetchCodexUsageLimits: codexFetch,
    });

    manager.start();
    await flushMicrotasks();

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

    await vi.advanceTimersByTimeAsync(60_000);

    expect(claudeFetch).toHaveBeenCalledTimes(2);
    expect(codexFetch).toHaveBeenCalledTimes(2);

    manager.close();
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
        hasCredentials: vi.fn().mockResolvedValue(false),
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

  it("should clear a cache when credentials become unavailable", async () => {
    const hasCredentials = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
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
        hasCredentials: vi.fn().mockResolvedValue(false),
      }),
      codexAuthService: createCodexAuthService({
        hasCredentials,
      }),
      codexBinaryPath: "codex",
      fetchClaudeUsageLimits: vi.fn(),
      fetchCodexUsageLimits: codexFetch,
    });

    await manager.refreshAll();
    expect(await manager.getCodexUsageLimits()).toEqual(
      expect.objectContaining({
        primary: expect.objectContaining({
          usedPercent: 50,
        }),
      }),
    );

    await manager.refreshAll();
    expect(await manager.getCodexUsageLimits()).toEqual(EMPTY_CODEX_USAGE_LIMITS);
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

function createClaudeCodeAuthService(
  overrides?: Partial<ClaudeCodeAuthService>,
): ClaudeCodeAuthService {
  return {
    getStatus: vi.fn(),
    createLoginUrl: vi.fn(),
    handleCallback: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    getUsageLimits: vi.fn().mockResolvedValue(EMPTY_CLAUDE_CODE_USAGE_LIMITS),
    hasCredentials: vi.fn().mockResolvedValue(true),
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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
