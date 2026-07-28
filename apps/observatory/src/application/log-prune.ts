import type { LogDao } from "@kagami/kernel/logger/dao/log.dao";

/** 日志保留窗口。原值来自 agent 的 `RETENTION_TASKS`（`app_log` 7 天），随表一起迁过来。 */
export const LOG_RETENTION_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type PruneAppLogsInput = {
  logDao: LogDao;
  retentionDays?: number;
  /** 注入"现在"，让保留窗口能被单测直接覆盖，不用假时钟。 */
  now: Date;
};

/**
 * 删掉超出保留窗口的日志，返回删除条数（issue #608）。
 *
 * 纯函数（除 DAO 这一次副作用），timer 只负责按点调它——这样验收和单测都不必等一个完整周期。
 */
export async function pruneAppLogs({
  logDao,
  retentionDays = LOG_RETENTION_DAYS,
  now,
}: PruneAppLogsInput): Promise<number> {
  const threshold = new Date(now.getTime() - retentionDays * MS_PER_DAY);
  return logDao.deleteOlderThan(threshold);
}
