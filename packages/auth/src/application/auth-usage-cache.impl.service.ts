import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type AuthUsageTrendWindow } from "@kagami/llm-api/auth-usage-trend";
import {
  ClaudeCodeUsageLimitsResponseSchema,
  type ClaudeCodeUsageLimitsResponse,
} from "@kagami/llm-api/claude-code-auth";
import {
  CodexUsageLimitsResponseSchema,
  type CodexUsageLimitsResponse,
} from "@kagami/llm-api/codex-auth";
import type {
  AuthUsageSnapshotDao,
  InsertAuthUsageSnapshotInput,
} from "@kagami/persistence/dao/auth-usage-snapshot.dao";
import type { ClaudeCodeProviderAuth } from "../claude-code/types.js";
import type { CodexProviderAuth } from "../codex/types.js";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { serializeError } from "@kagami/kernel/logger/serializer";
import type { ClaudeCodeAuthService } from "./claude-code-auth.service.js";
import type { CodexAuthService } from "./codex-auth.service.js";

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_CODEX_TIMEOUT_MS = 15_000;
const CLAUDE_USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_USAGE_USER_AGENT = "claude-code/2.1.39";
const logger = new AppLogger({ source: "auth-usage-cache" });

export const EMPTY_CLAUDE_CODE_USAGE_LIMITS: ClaudeCodeUsageLimitsResponse = {
  five_hour: null,
  seven_day: null,
  extra_usage: null,
};

export const EMPTY_CODEX_USAGE_LIMITS: CodexUsageLimitsResponse = {
  primary: null,
  secondary: null,
};

type AuthUsageCacheManagerDeps = {
  claudeCodeAuthService: ClaudeCodeAuthService;
  codexAuthService: CodexAuthService;
  codexBinaryPath: string;
  authUsageSnapshotDao?: AuthUsageSnapshotDao;
  refreshIntervalMs?: number;
  fetchClaudeUsageLimits?: (auth: ClaudeCodeProviderAuth) => Promise<ClaudeCodeUsageLimitsResponse>;
  fetchCodexUsageLimits?: (
    input: FetchCodexUsageLimitsViaAppServerInput,
  ) => Promise<CodexUsageLimitsResponse>;
};

export type FetchCodexUsageLimitsViaAppServerInput = {
  auth: CodexProviderAuth;
  binaryPath: string;
  timeoutMs?: number;
};

export class AuthUsageCacheManager {
  private readonly claudeCodeAuthService: ClaudeCodeAuthService;
  private readonly codexAuthService: CodexAuthService;
  private readonly codexBinaryPath: string;
  private readonly authUsageSnapshotDao: AuthUsageSnapshotDao | null;
  public readonly refreshIntervalMs: number;
  private readonly fetchClaudeUsageLimits: (
    auth: ClaudeCodeProviderAuth,
  ) => Promise<ClaudeCodeUsageLimitsResponse>;
  private readonly fetchCodexUsageLimits: (
    input: FetchCodexUsageLimitsViaAppServerInput,
  ) => Promise<CodexUsageLimitsResponse>;
  private claudeCodeUsageLimits = EMPTY_CLAUDE_CODE_USAGE_LIMITS;
  private codexUsageLimits = EMPTY_CODEX_USAGE_LIMITS;
  private isRefreshingClaudeCode = false;
  private isRefreshingCodex = false;

  public constructor({
    claudeCodeAuthService,
    codexAuthService,
    codexBinaryPath,
    authUsageSnapshotDao,
    refreshIntervalMs,
    fetchClaudeUsageLimits,
    fetchCodexUsageLimits,
  }: AuthUsageCacheManagerDeps) {
    this.claudeCodeAuthService = claudeCodeAuthService;
    this.codexAuthService = codexAuthService;
    this.codexBinaryPath = codexBinaryPath;
    this.authUsageSnapshotDao = authUsageSnapshotDao ?? null;
    this.refreshIntervalMs = refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.fetchClaudeUsageLimits = fetchClaudeUsageLimits ?? fetchClaudeCodeUsageLimitsFromApi;
    this.fetchCodexUsageLimits = fetchCodexUsageLimits ?? fetchCodexUsageLimitsViaAppServer;
  }

  public async getClaudeCodeUsageLimits(): Promise<ClaudeCodeUsageLimitsResponse> {
    return this.claudeCodeUsageLimits;
  }

  public async getCodexUsageLimits(): Promise<CodexUsageLimitsResponse> {
    return this.codexUsageLimits;
  }

  public async refreshAll(): Promise<void> {
    await Promise.allSettled([this.refreshClaudeCodeUsageLimits(), this.refreshCodexUsageLimits()]);
  }

  private async refreshClaudeCodeUsageLimits(): Promise<void> {
    if (this.isRefreshingClaudeCode) {
      return;
    }

    this.isRefreshingClaudeCode = true;
    try {
      const status = await this.claudeCodeAuthService.getStatus();
      if (status.status !== "active") {
        this.claudeCodeUsageLimits = EMPTY_CLAUDE_CODE_USAGE_LIMITS;
        return;
      }

      let auth: ClaudeCodeProviderAuth;
      try {
        auth = await this.claudeCodeAuthService.getAuthWithoutRefresh();
      } catch {
        this.claudeCodeUsageLimits = EMPTY_CLAUDE_CODE_USAGE_LIMITS;
        return;
      }

      const capturedAt = new Date();
      this.claudeCodeUsageLimits = await this.fetchClaudeUsageLimits(auth);
      await this.recordClaudeCodeSnapshots({
        auth,
        limits: this.claudeCodeUsageLimits,
        capturedAt,
      });
    } catch (error) {
      logger.warn("Failed to refresh Claude Code usage limits", {
        event: "auth_usage_cache.claude_code_refresh_failed",
        error: serializeError(error),
      });
    } finally {
      this.isRefreshingClaudeCode = false;
    }
  }

  private async refreshCodexUsageLimits(): Promise<void> {
    if (this.isRefreshingCodex) {
      return;
    }

    this.isRefreshingCodex = true;
    try {
      let auth: CodexProviderAuth;
      try {
        auth = await this.codexAuthService.getAuthWithoutRefresh();
      } catch {
        this.codexUsageLimits = EMPTY_CODEX_USAGE_LIMITS;
        return;
      }

      const capturedAt = new Date();
      this.codexUsageLimits = await this.fetchCodexUsageLimits({
        auth,
        binaryPath: this.codexBinaryPath,
      });
      await this.recordCodexSnapshots({
        auth,
        limits: this.codexUsageLimits,
        capturedAt,
      });
    } catch (error) {
      logger.warn("Failed to refresh Codex usage limits", {
        event: "auth_usage_cache.codex_refresh_failed",
        error: serializeError(error),
      });
    } finally {
      this.isRefreshingCodex = false;
    }
  }

  private async recordClaudeCodeSnapshots(input: {
    auth: ClaudeCodeProviderAuth;
    limits: ClaudeCodeUsageLimitsResponse;
    capturedAt: Date;
  }): Promise<void> {
    if (!this.authUsageSnapshotDao) {
      return;
    }

    if (!input.auth.accountId) {
      logger.warn("Skip recording Claude Code usage trend without account id", {
        event: "auth_usage_cache.claude_code_snapshot_skipped",
      });
      return;
    }

    const items: InsertAuthUsageSnapshotInput[] = [];
    if (input.limits.five_hour) {
      items.push({
        provider: "claude-code",
        accountId: input.auth.accountId,
        windowKey: "five_hour",
        remainingPercent: toRemainingPercent(input.limits.five_hour.utilization),
        resetAt: toOptionalDate(input.limits.five_hour.resets_at),
        capturedAt: input.capturedAt,
      });
    }
    if (input.limits.seven_day) {
      items.push({
        provider: "claude-code",
        accountId: input.auth.accountId,
        windowKey: "seven_day",
        remainingPercent: toRemainingPercent(input.limits.seven_day.utilization),
        resetAt: toOptionalDate(input.limits.seven_day.resets_at),
        capturedAt: input.capturedAt,
      });
    }

    await this.authUsageSnapshotDao.insertBatch(items);
  }

  private async recordCodexSnapshots(input: {
    auth: CodexProviderAuth;
    limits: CodexUsageLimitsResponse;
    capturedAt: Date;
  }): Promise<void> {
    if (!this.authUsageSnapshotDao) {
      return;
    }

    if (!input.auth.accountId) {
      logger.warn("Skip recording Codex usage trend without account id", {
        event: "auth_usage_cache.codex_snapshot_skipped",
      });
      return;
    }

    const items: InsertAuthUsageSnapshotInput[] = [];
    for (const window of [input.limits.primary, input.limits.secondary]) {
      if (!window) {
        continue;
      }

      const windowKey = mapCodexWindowKey(window.windowDurationMins);
      if (!windowKey) {
        logger.warn("Skip unsupported Codex usage window", {
          event: "auth_usage_cache.codex_snapshot_window_unsupported",
          windowDurationMins: window.windowDurationMins,
        });
        continue;
      }

      items.push({
        provider: "openai-codex",
        accountId: input.auth.accountId,
        windowKey,
        remainingPercent: toRemainingPercent(window.usedPercent),
        resetAt: toOptionalDate(window.resetsAt),
        capturedAt: input.capturedAt,
      });
    }

    await this.authUsageSnapshotDao.insertBatch(items);
  }
}

function mapCodexWindowKey(windowDurationMins: number): AuthUsageTrendWindow | null {
  if (windowDurationMins === 300) {
    return "five_hour";
  }

  if (windowDurationMins === 10_080) {
    return "seven_day";
  }

  return null;
}

function toOptionalDate(value: number | string | null): Date | null {
  if (value === null) {
    return null;
  }

  const date =
    typeof value === "number"
      ? new Date(value < 10_000_000_000 ? value * 1000 : value)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toRemainingPercent(usedPercent: number): number {
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function fetchClaudeCodeUsageLimitsFromApi(
  auth: ClaudeCodeProviderAuth,
): Promise<ClaudeCodeUsageLimitsResponse> {
  const response = await fetch(CLAUDE_USAGE_ENDPOINT, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
      "User-Agent": CLAUDE_USAGE_USER_AGENT,
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  if (!response.ok) {
    throw new BizError({
      message: `Claude Code usage request failed: ${response.status}`,
      statusCode: 502,
      meta: { httpStatus: response.status },
    });
  }

  const data = (await response.json()) as Record<string, unknown>;
  return ClaudeCodeUsageLimitsResponseSchema.parse({
    five_hour: normalizeClaudeCodeUsageLimitWindow(data.five_hour),
    seven_day: normalizeClaudeCodeUsageLimitWindow(data.seven_day),
    extra_usage: normalizeClaudeCodeExtraUsage(data.extra_usage),
  });
}

function normalizeClaudeCodeUsageLimitWindow(
  value: unknown,
): ClaudeCodeUsageLimitsResponse["five_hour"] {
  if (!isRecord(value)) {
    return null;
  }

  return {
    utilization: value.utilization as number,
    resets_at: (value.resets_at ?? null) as string | null,
  };
}

function normalizeClaudeCodeExtraUsage(
  value: unknown,
): ClaudeCodeUsageLimitsResponse["extra_usage"] {
  if (!isRecord(value)) {
    return null;
  }

  return {
    is_enabled: value.is_enabled as boolean,
    monthly_limit: (value.monthly_limit ?? null) as number | null,
    used_credits: (value.used_credits ?? null) as number | null,
    utilization: (value.utilization ?? null) as number | null,
  };
}

export async function fetchCodexUsageLimitsViaAppServer({
  auth,
  binaryPath,
  timeoutMs = DEFAULT_CODEX_TIMEOUT_MS,
}: FetchCodexUsageLimitsViaAppServerInput): Promise<CodexUsageLimitsResponse> {
  const codexHome = await mkdtemp(path.join(tmpdir(), "kagami-codex-home-"));
  const authFilePath = path.join(codexHome, "auth.json");
  const authFile = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: auth.idToken ?? null,
      access_token: auth.accessToken,
      refresh_token: auth.refreshToken,
      account_id: auth.accountId ?? null,
    },
    last_refresh: auth.lastRefresh,
  };

  await writeFile(authFilePath, JSON.stringify(authFile, null, 2), "utf8");

  const child = spawn(binaryPath, ["app-server"], {
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    return await readCodexRateLimitsFromChildProcess({
      child,
      timeoutMs,
    });
  } finally {
    child.kill("SIGTERM");
    await waitForChildExit(child);
    await rm(codexHome, { recursive: true, force: true });
  }
}

async function readCodexRateLimitsFromChildProcess(input: {
  child: ChildProcessWithoutNullStreams;
  timeoutMs: number;
}): Promise<CodexUsageLimitsResponse> {
  return await new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    const { child } = input;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      child.stdout.off("data", handleStdout);
      child.stderr.off("data", handleStderr);
      child.off("error", handleError);
      child.off("exit", handleExit);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (value: CodexUsageLimitsResponse) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(value);
    };

    const sendRequest = (id: number, method: string, params: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    };

    const handleJsonLine = (line: string) => {
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
      } catch {
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          fail(
            new Error(
              `Codex app-server initialize failed: ${message.error.message ?? "unknown error"}`,
            ),
          );
          return;
        }

        sendRequest(2, "account/rateLimits/read", {});
        return;
      }

      if (message.id === 2) {
        if (message.error) {
          fail(
            new Error(
              `Codex app-server rate limits failed: ${message.error.message ?? "unknown error"}`,
            ),
          );
          return;
        }

        const result = message.result as { rateLimits?: Record<string, unknown> } | null;
        const rateLimits = result?.rateLimits;
        if (!rateLimits) {
          fail(new Error("Codex app-server returned no rate limits"));
          return;
        }

        succeed(
          CodexUsageLimitsResponseSchema.parse({
            primary: rateLimits.primary ?? null,
            secondary: rateLimits.secondary ?? null,
          }),
        );
      }
    };

    const handleStdout = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }

        handleJsonLine(trimmed);
      }
    };

    const handleStderr = (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    };

    const handleError = (error: Error) => {
      fail(error);
    };

    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }

      const suffix = stderrBuffer.trim().length > 0 ? `: ${stderrBuffer.trim()}` : "";
      fail(
        new Error(
          `Codex app-server exited before responding (code=${code}, signal=${signal})${suffix}`,
        ),
      );
    };

    const timeoutHandle = setTimeout(() => {
      const suffix = stderrBuffer.trim().length > 0 ? `: ${stderrBuffer.trim()}` : "";
      fail(new Error(`Codex app-server timed out after ${input.timeoutMs}ms${suffix}`));
    }, input.timeoutMs);

    child.stdout.on("data", handleStdout);
    child.stderr.on("data", handleStderr);
    child.on("error", handleError);
    child.on("exit", handleExit);

    sendRequest(1, "initialize", {
      clientInfo: {
        name: "kagami",
        version: "0.0.0",
      },
    });
  });
}

async function waitForChildExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  // 幂等：进程已退出时直接返回，重复调用不会挂起或抛错。
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    await once(child, "exit");
  } catch (error) {
    // 这里等待的是子进程「退出」事件本身的失败（罕见的 EventEmitter 错误）。
    // 「未登录 / 无 codex CLI / 正常退出」都不会走到这条 catch（它们会正常 emit exit），
    // 因此只在真正异常时记 warn，绝不刷 error，也不向上抛断 finally 清理链。
    logger.warn("Failed while waiting for codex app-server child exit", {
      event: "auth_usage_cache.codex_child_exit_wait_failed",
      error: serializeError(error),
    });
  }
}
