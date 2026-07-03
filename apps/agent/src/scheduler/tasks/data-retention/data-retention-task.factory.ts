import type { Database } from "@kagami/persistence/db/client";
import type { MetricClient } from "@kagami/metric-client/client";
import type { ScheduledTask, TaskRunMetadata } from "../../domain/scheduled-task.js";
import {
  RETENTION_TASKS,
  type PrismaRetentionDelegate,
  type RetentionSpec,
} from "./retention-tasks.js";

const CHUNK_SIZE = 5_000;
const DAY_MS = 86_400_000;

type DataRetentionTaskDeps = {
  db: Database;
  metricService: MetricClient;
  spec: RetentionSpec;
};

function buildTask({ db, metricService, spec }: DataRetentionTaskDeps): ScheduledTask {
  const taskName = `data-retention:${spec.displayName}`;
  const expression = `${spec.offsetMinutes} 0 * * *`;

  return {
    name: taskName,
    schedule: { kind: "cron", expression },
    async run(signal: AbortSignal): Promise<TaskRunMetadata> {
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
}): ScheduledTask[] {
  return RETENTION_TASKS.map(spec =>
    buildTask({ db: deps.db, metricService: deps.metricService, spec }),
  );
}
