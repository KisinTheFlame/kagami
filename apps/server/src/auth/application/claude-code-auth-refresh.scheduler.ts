import { AppLogger } from "../../logger/logger.js";
import { serializeError } from "../../logger/serializer.js";
import type { ClaudeCodeAuthService } from "./claude-code-auth.service.js";

const logger = new AppLogger({ source: "claude-code-auth-refresh-scheduler" });

type ClaudeCodeAuthRefreshSchedulerDeps = {
  claudeCodeAuthService: ClaudeCodeAuthService;
  refreshCheckIntervalMs: number;
  refreshLeewayMs: number;
  now?: () => Date;
};

type ClaudeCodeAuthStatus = Awaited<ReturnType<ClaudeCodeAuthService["getStatus"]>>;

type PendingClaudeCodeRefreshContext = {
  provider: ClaudeCodeAuthStatus["provider"];
  authStatus: ClaudeCodeAuthStatus["status"];
  session: {
    accountId: string | null;
    email: string | null;
    expiresAt: string;
    lastRefreshAt: string | null;
    lastError: string | null;
  };
  refreshCheckIntervalMs: number;
  refreshLeewayMs: number;
};

export class ClaudeCodeAuthRefreshScheduler {
  private readonly claudeCodeAuthService: ClaudeCodeAuthService;
  private readonly refreshCheckIntervalMs: number;
  private readonly refreshLeewayMs: number;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<void> | null = null;

  public constructor({
    claudeCodeAuthService,
    refreshCheckIntervalMs,
    refreshLeewayMs,
    now,
  }: ClaudeCodeAuthRefreshSchedulerDeps) {
    this.claudeCodeAuthService = claudeCodeAuthService;
    this.refreshCheckIntervalMs = refreshCheckIntervalMs;
    this.refreshLeewayMs = refreshLeewayMs;
    this.now = now ?? (() => new Date());
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.refreshCheckIntervalMs);
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

  private async tick(): Promise<void> {
    if (this.refreshPromise) {
      return;
    }

    const refreshContext = await this.getPendingRefreshContext();
    if (!refreshContext) {
      return;
    }

    this.refreshPromise = this.runRefresh(refreshContext);
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async runRefresh(refreshContext: PendingClaudeCodeRefreshContext): Promise<void> {
    try {
      await this.claudeCodeAuthService.refresh();
    } catch (error) {
      logger.warn("Failed to refresh Claude Code auth session", {
        event: "claude_code_auth_refresh_scheduler.refresh_failed",
        provider: refreshContext.provider,
        authStatus: refreshContext.authStatus,
        session: refreshContext.session,
        refreshCheckIntervalMs: refreshContext.refreshCheckIntervalMs,
        refreshLeewayMs: refreshContext.refreshLeewayMs,
        error: serializeError(error),
      });
    }
  }

  private async getPendingRefreshContext(): Promise<PendingClaudeCodeRefreshContext | null> {
    const status = await this.claudeCodeAuthService.getStatus();
    if ((status.status !== "active" && status.status !== "expired") || !status.session?.expiresAt) {
      return null;
    }

    const expiresAt = new Date(status.session.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return null;
    }

    if (expiresAt.getTime() - this.refreshLeewayMs > this.now().getTime()) {
      return null;
    }

    return {
      provider: status.provider,
      authStatus: status.status,
      session: {
        accountId: status.session.accountId,
        email: status.session.email,
        expiresAt: status.session.expiresAt,
        lastRefreshAt: status.session.lastRefreshAt,
        lastError: status.session.lastError,
      },
      refreshCheckIntervalMs: this.refreshCheckIntervalMs,
      refreshLeewayMs: this.refreshLeewayMs,
    };
  }
}
