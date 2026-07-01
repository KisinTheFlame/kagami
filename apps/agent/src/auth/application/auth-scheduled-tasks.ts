import type { AuthUsageCacheManager, OAuthAuthRefreshScheduler } from "@kagami/auth";
import type { ScheduledTask } from "../../scheduler/domain/scheduled-task.js";

type BuildAuthScheduledTasksDeps = {
  codexAuthRefreshScheduler: OAuthAuthRefreshScheduler;
  claudeCodeAuthRefreshScheduler: OAuthAuthRefreshScheduler;
  authUsageCacheManager: AuthUsageCacheManager;
};

export function buildAuthScheduledTasks({
  codexAuthRefreshScheduler,
  claudeCodeAuthRefreshScheduler,
  authUsageCacheManager,
}: BuildAuthScheduledTasksDeps): ScheduledTask[] {
  return [
    {
      name: "auth-refresh:codex",
      schedule: {
        kind: "interval",
        intervalMs: codexAuthRefreshScheduler.refreshCheckIntervalMs,
      },
      run: async () => {
        await codexAuthRefreshScheduler.runOnce();
      },
    },
    {
      name: "auth-refresh:claude-code",
      schedule: {
        kind: "interval",
        intervalMs: claudeCodeAuthRefreshScheduler.refreshCheckIntervalMs,
      },
      run: async () => {
        await claudeCodeAuthRefreshScheduler.runOnce();
      },
    },
    {
      // Usage snapshots refresh every 10 minutes on the wall clock
      // (00, 10, 20, 30, 40, 50). Cron, not interval, so restarts don't
      // misalign the cadence.
      name: "auth-usage-refresh",
      schedule: { kind: "cron", expression: "*/10 * * * *" },
      run: async () => {
        await authUsageCacheManager.refreshAll();
      },
    },
  ];
}
