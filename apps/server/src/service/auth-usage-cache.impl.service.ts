import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ClaudeCodeUsageLimitsResponseSchema,
  type ClaudeCodeUsageLimitsResponse,
  CodexUsageLimitsResponseSchema,
  type CodexUsageLimitsResponse,
} from "@kagami/shared";
import type { ClaudeCodeProviderAuth } from "../claude-code-auth/types.js";
import type { CodexProviderAuth } from "../codex-auth/types.js";
import { AppLogger } from "../logger/logger.js";
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
  private readonly refreshIntervalMs: number;
  private readonly fetchClaudeUsageLimits: (
    auth: ClaudeCodeProviderAuth,
  ) => Promise<ClaudeCodeUsageLimitsResponse>;
  private readonly fetchCodexUsageLimits: (
    input: FetchCodexUsageLimitsViaAppServerInput,
  ) => Promise<CodexUsageLimitsResponse>;
  private timer: NodeJS.Timeout | null = null;
  private claudeCodeUsageLimits = EMPTY_CLAUDE_CODE_USAGE_LIMITS;
  private codexUsageLimits = EMPTY_CODEX_USAGE_LIMITS;
  private isRefreshingClaudeCode = false;
  private isRefreshingCodex = false;

  public constructor({
    claudeCodeAuthService,
    codexAuthService,
    codexBinaryPath,
    refreshIntervalMs,
    fetchClaudeUsageLimits,
    fetchCodexUsageLimits,
  }: AuthUsageCacheManagerDeps) {
    this.claudeCodeAuthService = claudeCodeAuthService;
    this.codexAuthService = codexAuthService;
    this.codexBinaryPath = codexBinaryPath;
    this.refreshIntervalMs = refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.fetchClaudeUsageLimits = fetchClaudeUsageLimits ?? fetchClaudeCodeUsageLimitsFromApi;
    this.fetchCodexUsageLimits = fetchCodexUsageLimits ?? fetchCodexUsageLimitsViaAppServer;
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.refreshAll();
    this.timer = setInterval(() => {
      void this.refreshAll();
    }, this.refreshIntervalMs);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  public close(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
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
      if (!(await this.claudeCodeAuthService.hasCredentials())) {
        this.claudeCodeUsageLimits = EMPTY_CLAUDE_CODE_USAGE_LIMITS;
        return;
      }

      const auth = await this.claudeCodeAuthService.getAuth();
      this.claudeCodeUsageLimits = await this.fetchClaudeUsageLimits(auth);
    } catch (error) {
      logger.warn("Failed to refresh Claude Code usage limits", {
        event: "auth_usage_cache.claude_code_refresh_failed",
        error: error instanceof Error ? error.message : String(error),
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
      if (!(await this.codexAuthService.hasCredentials())) {
        this.codexUsageLimits = EMPTY_CODEX_USAGE_LIMITS;
        return;
      }

      const auth = await this.codexAuthService.getAuth();
      this.codexUsageLimits = await this.fetchCodexUsageLimits({
        auth,
        binaryPath: this.codexBinaryPath,
      });
    } catch (error) {
      logger.warn("Failed to refresh Codex usage limits", {
        event: "auth_usage_cache.codex_refresh_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isRefreshingCodex = false;
    }
  }
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
    throw new Error(`Claude Code usage request failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return ClaudeCodeUsageLimitsResponseSchema.parse({
    five_hour: data.five_hour ?? null,
    seven_day: data.seven_day ?? null,
    extra_usage: data.extra_usage ?? null,
  });
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
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await once(child, "exit").catch(() => {});
}
