import { AppLogger } from "../../logger/logger.js";
import type { ClaudeCodeAuthService } from "./claude-code-auth.service.js";

const logger = new AppLogger({ source: "claude-code-auth-refresh-scheduler" });

type ClaudeCodeAuthRefreshSchedulerDeps = {
  claudeCodeAuthService: ClaudeCodeAuthService;
  refreshCheckIntervalMs: number;
  refreshLeewayMs: number;
  now?: () => Date;
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

    if (!(await this.shouldRefresh())) {
      return;
    }

    this.refreshPromise = this.runRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async runRefresh(): Promise<void> {
    try {
      await this.claudeCodeAuthService.refresh();
    } catch (error) {
      logger.warn("Failed to refresh Claude Code auth session", {
        event: "claude_code_auth_refresh_scheduler.refresh_failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async shouldRefresh(): Promise<boolean> {
    const status = await this.claudeCodeAuthService.getStatus();
    if ((status.status !== "active" && status.status !== "expired") || !status.session?.expiresAt) {
      return false;
    }

    const expiresAt = new Date(status.session.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return false;
    }

    return expiresAt.getTime() - this.refreshLeewayMs <= this.now().getTime();
  }
}
