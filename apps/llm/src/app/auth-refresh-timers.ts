import { AppLogger } from "@kagami/kernel/logger/logger";
import type { AuthUsageCacheManager, OAuthAuthRefreshScheduler } from "@kagami/auth";

const logger = new AppLogger({ source: "llm-service.auth-refresh-timers" });

// usage 快照刷新周期：10 分钟。原 agent 用 cron */10（挂钟对齐）；服务进程改用普通
// interval——挂钟对齐只是为了重启后不错位，对"每 10 分钟刷一次配额"无实质影响。
const USAGE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type AuthRefreshTimers = {
  stop(): void;
};

/**
 * 在 kagami-llm 进程内用自己的 timer 驱动 OAuth 刷新 + usage 快照刷新。
 * 不引入 agent 的 TaskScheduler（那是 agent app 层类型），只调 auth 模块暴露的能力。
 * 每个 runOnce/refreshAll 都 fire-and-forget 且内部 catch，任何一次失败都不影响后续与主流程。
 */
export function startAuthRefreshTimers({
  refreshSchedulers,
  authUsageCacheManager,
}: {
  refreshSchedulers: OAuthAuthRefreshScheduler[];
  authUsageCacheManager: AuthUsageCacheManager;
}): AuthRefreshTimers {
  const timers: NodeJS.Timeout[] = [];

  for (const scheduler of refreshSchedulers) {
    const timer = setInterval(() => {
      void scheduler.runOnce().catch((error: unknown) => {
        logger.errorWithCause("Auth refresh runOnce failed", error, {
          event: "llm_service.auth_refresh.failed",
        });
      });
    }, scheduler.refreshCheckIntervalMs);
    timer.unref();
    timers.push(timer);
  }

  const usageTimer = setInterval(() => {
    void authUsageCacheManager.refreshAll().catch((error: unknown) => {
      logger.errorWithCause("Auth usage refresh failed", error, {
        event: "llm_service.auth_usage_refresh.failed",
      });
    });
  }, USAGE_REFRESH_INTERVAL_MS);
  usageTimer.unref();
  timers.push(usageTimer);

  return {
    stop(): void {
      for (const timer of timers) {
        clearInterval(timer);
      }
    },
  };
}
