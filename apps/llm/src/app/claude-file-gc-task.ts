import type { SchedulerTaskRegistration } from "@kagami/scheduler-client/types";
import type { TaskRunMetadata } from "@kagami/scheduler-client/task-run";
import {
  runClaudeFileGc,
  createClaudeCodeAccessTokenGetter,
  type ClaudeFileCacheDao,
  type ClaudeCodeAuthProvider,
} from "@kagami/llm-client";

/**
 * Claude Files API 缓存按最近使用时间 GC 的定时任务注册（#433，甲：任务定义在使用方）。
 * kagami-llm 进程经 SchedulerClient 注册这个每日 cron；tick 回来后 handler 在本进程内跑
 * runClaudeFileGc（DAO / OAuth token / HTTP 都在本进程）。业务本体在 @kagami/llm-client。
 */

const GC_CONCURRENCY = 4;

type ClaudeFileGcTaskDeps = {
  fileCacheDao: ClaudeFileCacheDao;
  authStore: ClaudeCodeAuthProvider;
  baseUrl: string;
  maxIdleDays: number;
  maxDeletionsPerRun: number;
  timeoutMs: number;
};

export function buildClaudeFileGcTask(deps: ClaudeFileGcTaskDeps): SchedulerTaskRegistration {
  const getAccessToken = createClaudeCodeAccessTokenGetter(deps.authStore);
  return {
    name: "llm:gc-claude-files",
    // 每天 04:00（scheduler 默认时区 = 服务器本地，与 data-retention 一致）；避开其 00:xx。
    schedule: { kind: "cron", expression: "0 4 * * *" },
    misfire: "drop", // 漏一次无害，次日全量兜住（下轮删的是"所有 idle 行"，不依赖单次触发）
    overlap: "skip",
    handler: async (signal: AbortSignal): Promise<TaskRunMetadata> =>
      runClaudeFileGc({
        fileCacheDao: deps.fileCacheDao,
        getAccessToken,
        baseUrl: deps.baseUrl,
        maxIdleDays: deps.maxIdleDays,
        maxDeletionsPerRun: deps.maxDeletionsPerRun,
        concurrency: GC_CONCURRENCY,
        timeoutMs: deps.timeoutMs,
        signal,
      }),
  };
}
