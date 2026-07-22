import type { MetricClient } from "@kagami/metric-client/client";
import type { SchedulerTaskRegistration } from "@kagami/scheduler-client/types";
import type { TaskRunMetadata } from "@kagami/scheduler-client/task-run";
import type { Database } from "../infra/db/client.js";

const CHUNK_SIZE = 5_000;
const DAY_MS = 86_400_000;

/**
 * `findMany` / `deleteMany` subset of a Prisma delegate that retention needs.
 */
type PrismaRetentionDelegate = {
  findMany(args: {
    where: Record<string, { lt: Date }>;
    select: { id: true };
    take: number;
  }): Promise<{ id: number }[]>;
  deleteMany(args: { where: { id: { in: number[] } } }): Promise<{ count: number }>;
};

type RetentionSpec = {
  displayName: string;
  field: "createdAt" | "expiresAt";
  days: number;
  offsetMinutes: number;
  getDelegate: (db: Database) => unknown;
};

/**
 * llm 独占库的数据保留清理（epic #539 子 issue 3：随表从 agent 的 data-retention 迁入本进程，
 * 窗口沿用原值不变）。执行器照抄 agent 范式：每日凌晨错峰、5000 行分块删 + setImmediate 让步 +
 * AbortSignal 可中止，删除行数打 `scheduler.retention.deleted_rows` metric（保留面可观测性与
 * 原 agent 清理完全一致）。claude_file_cache 不在此列——它有自己的 GC（#433，按 lastUsedAt）。
 */
const RETENTION_TASKS: readonly RetentionSpec[] = [
  {
    displayName: "llm_chat_call",
    field: "createdAt",
    days: 1,
    offsetMinutes: 5,
    getDelegate: db => db.llmChatCall,
  },
  {
    displayName: "embedding_cache",
    field: "createdAt",
    days: 30,
    offsetMinutes: 35,
    getDelegate: db => db.embeddingCache,
  },
  {
    // oauth_state 用 expiresAt：它有单列索引且 state 行创建后 ~10 分钟即过期，
    // `expiresAt < now - 7d` 与 createdAt 语义等价（沿用 agent 侧既有判据）。
    displayName: "oauth_state",
    field: "expiresAt",
    days: 7,
    offsetMinutes: 40,
    getDelegate: db => db.oauthState,
  },
];

type DataRetentionRegistrationDeps = {
  db: Database;
  metricService: MetricClient;
  spec: RetentionSpec;
};

function buildRegistration({
  db,
  metricService,
  spec,
}: DataRetentionRegistrationDeps): SchedulerTaskRegistration {
  const taskName = `data-retention:${spec.displayName}`;
  const expression = `${spec.offsetMinutes} 0 * * *`;

  return {
    name: taskName,
    schedule: { kind: "cron", expression },
    misfire: "drop",
    overlap: "skip",
    handler: async (signal: AbortSignal): Promise<TaskRunMetadata> => {
      const threshold = new Date(Date.now() - spec.days * DAY_MS);
      const delegate = spec.getDelegate(db) as PrismaRetentionDelegate;

      let deletedRows = 0;
      let chunks = 0;

      while (!signal.aborted) {
        const ids = await delegate.findMany({
          where: { [spec.field]: { lt: threshold } },
          select: { id: true },
          take: CHUNK_SIZE,
        });
        if (ids.length === 0) {
          break;
        }

        const { count } = await delegate.deleteMany({
          where: { id: { in: ids.map(row => row.id) } },
        });
        deletedRows += count;
        chunks += 1;

        await new Promise(resolve => setImmediate(resolve));

        if (ids.length < CHUNK_SIZE) {
          break;
        }
      }

      await metricService.record({
        metricName: "scheduler.retention.deleted_rows",
        value: deletedRows,
        tags: { table: spec.displayName },
      });

      return {
        deletedRows,
        chunks,
        thresholdIso: threshold.toISOString(),
        aborted: signal.aborted,
      };
    },
  };
}

export function buildLlmDataRetentionTasks({
  db,
  metricService,
}: {
  db: Database;
  metricService: MetricClient;
}): SchedulerTaskRegistration[] {
  return RETENTION_TASKS.map(spec => buildRegistration({ db, metricService, spec }));
}
