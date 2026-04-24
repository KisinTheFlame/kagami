import { AppLogger } from "../../logger/logger.js";
import { serializeError } from "../../logger/serializer.js";
import type { OAuthAuthService } from "./oauth-auth.service.js";

const logger = new AppLogger({ source: "oauth-auth-refresh-scheduler" });

type OAuthAuthRefreshSchedulerDeps = {
  authService: OAuthAuthService;
  displayName: string;
  logEventPrefix: string;
  refreshCheckIntervalMs: number;
  refreshLeewayMs: number;
  now?: () => Date;
};

type OAuthAuthStatus = Awaited<ReturnType<OAuthAuthService["getStatus"]>>;

type PendingOAuthRefreshContext = {
  provider: OAuthAuthStatus["provider"];
  authStatus: OAuthAuthStatus["status"];
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

export class OAuthAuthRefreshScheduler {
  private readonly authService: OAuthAuthService;
  private readonly displayName: string;
  private readonly logEventPrefix: string;
  public readonly refreshCheckIntervalMs: number;
  private readonly refreshLeewayMs: number;
  private readonly now: () => Date;

  public constructor({
    authService,
    displayName,
    logEventPrefix,
    refreshCheckIntervalMs,
    refreshLeewayMs,
    now,
  }: OAuthAuthRefreshSchedulerDeps) {
    this.authService = authService;
    this.displayName = displayName;
    this.logEventPrefix = logEventPrefix;
    this.refreshCheckIntervalMs = refreshCheckIntervalMs;
    this.refreshLeewayMs = refreshLeewayMs;
    this.now = now ?? (() => new Date());
  }

  public async runOnce(): Promise<void> {
    const refreshContext = await this.getPendingRefreshContext();
    if (!refreshContext) {
      return;
    }

    await this.runRefresh(refreshContext);
  }

  private async runRefresh(refreshContext: PendingOAuthRefreshContext): Promise<void> {
    try {
      await this.authService.refresh();
    } catch (error) {
      logger.warn(`Failed to refresh ${this.displayName} auth session`, {
        event: `${this.logEventPrefix}.refresh_failed`,
        provider: refreshContext.provider,
        authStatus: refreshContext.authStatus,
        session: refreshContext.session,
        refreshCheckIntervalMs: refreshContext.refreshCheckIntervalMs,
        refreshLeewayMs: refreshContext.refreshLeewayMs,
        error: serializeError(error),
      });
    }
  }

  private async getPendingRefreshContext(): Promise<PendingOAuthRefreshContext | null> {
    const status = await this.authService.getStatus();
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
