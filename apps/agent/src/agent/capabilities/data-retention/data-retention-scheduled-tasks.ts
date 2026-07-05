import type { Database } from "@kagami/persistence/db/client";
import type { MetricClient } from "@kagami/metric-client/client";
import type { SchedulerTaskRegistration } from "@kagami/scheduler-client/types";
import type { TaskRunMetadata } from "@kagami/scheduler-client/task-run";
import {
  RETENTION_TASKS,
  type PrismaRetentionDelegate,
  type RetentionSpec,
} from "./retention-tasks.js";

const CHUNK_SIZE = 5_000;
const DAY_MS = 86_400_000;

type DataRetentionRegistrationDeps = {
  db: Database;
  metricService: MetricClient;
  spec: RetentionSpec;
};

/**
 * 一个表的数据保留定时任务注册（甲：定义在使用方，issue #428）。分块删除超保留窗口的旧行；
 * misfire=drop（漏一次无害，次日照跑）、overlap=skip。handler 收 AbortSignal 供优雅关停（大表分块
 * 删到一半收到关停即停）。业务（保留哪些表 / 各自窗口）仍在使用方，调度器只是到点 tick。
 */
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

export function buildDataRetentionTasks(deps: {
  db: Database;
  metricService: MetricClient;
}): SchedulerTaskRegistration[] {
  return RETENTION_TASKS.map(spec =>
    buildRegistration({ db: deps.db, metricService: deps.metricService, spec }),
  );
}
