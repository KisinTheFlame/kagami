import { describe, expect, it, vi } from "vitest";
import type { Database } from "@kagami/persistence/db/client";
import type { MetricClient } from "@kagami/metric-client/client";
import type { SchedulerTick } from "@kagami/scheduler-client/types";
import { buildDataRetentionTasks } from "../../../../src/agent/capabilities/data-retention/data-retention-scheduled-tasks.js";
import { RETENTION_TASKS } from "../../../../src/agent/capabilities/data-retention/retention-tasks.js";

const FAKE_TICK: SchedulerTick = {
  taskName: "data-retention:app_log",
  occurrenceId: "data-retention:app_log@2026-07-05T00:00:00.000Z",
  scheduledAt: "2026-07-05T00:00:00.000Z",
  emittedAt: "2026-07-05T00:00:00.000Z",
  manual: false,
};

function makeMetricClient(): MetricClient {
  return {
    record: vi.fn(async () => {}),
  };
}

type FakeDelegate = {
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};

function makeDelegate(rows: number): FakeDelegate {
  let remaining = rows;
  return {
    findMany: vi.fn(async ({ take }: { take: number }) => {
      if (remaining <= 0) {
        return [];
      }
      const batchSize = Math.min(take, remaining);
      const ids = Array.from({ length: batchSize }, (_, i) => ({ id: remaining - i }));
      return ids;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) => {
      const count = where.id.in.length;
      remaining -= count;
      return { count };
    }),
  };
}

describe("buildDataRetentionTasks", () => {
  it("registers exactly one task per retention spec with drop/skip policy", () => {
    const metricService = makeMetricClient();
    const db = {} as Database;
    const tasks = buildDataRetentionTasks({ db, metricService });
    expect(tasks).toHaveLength(RETENTION_TASKS.length);
    expect(tasks.map(t => t.name)).toEqual(
      RETENTION_TASKS.map(spec => `data-retention:${spec.displayName}`),
    );
    for (const task of tasks) {
      expect(task.misfire).toBe("drop");
      expect(task.overlap).toBe("skip");
    }
  });

  it("each task uses a staggered cron at 00:<offset>", () => {
    const tasks = buildDataRetentionTasks({
      db: {} as Database,
      metricService: makeMetricClient(),
    });
    for (let i = 0; i < tasks.length; i++) {
      const spec = RETENTION_TASKS[i]!;
      const task = tasks[i]!;
      expect(task.schedule).toEqual({
        kind: "cron",
        expression: `${spec.offsetMinutes} 0 * * *`,
      });
    }
  });

  it("loops in chunks until no more expired rows and emits a metric", async () => {
    const metricService = makeMetricClient();
    const spec = RETENTION_TASKS[0]!;
    const delegate = makeDelegate(12_000);

    const db = {
      [toCamelProperty(spec.displayName)]: delegate,
    } as unknown as Database;

    const task = buildDataRetentionTasks({ db, metricService }).find(
      t => t.name === `data-retention:${spec.displayName}`,
    );
    expect(task).toBeDefined();

    const abort = new AbortController();
    const metadata = await task!.handler(abort.signal, FAKE_TICK);

    expect(metadata).toMatchObject({
      deletedRows: 12_000,
      chunks: 3,
      aborted: false,
    });
    expect(delegate.findMany).toHaveBeenCalledTimes(3);
    expect(delegate.deleteMany).toHaveBeenCalledTimes(3);
    expect(metricService.record).toHaveBeenCalledTimes(1);
    expect(metricService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metricName: "scheduler.retention.deleted_rows",
        value: 12_000,
        tags: { table: spec.displayName },
      }),
    );
  });

  it("aborts the loop when the signal is triggered between chunks", async () => {
    const metricService = makeMetricClient();
    const spec = RETENTION_TASKS[0]!;
    const delegate = makeDelegate(20_000);

    const db = {
      [toCamelProperty(spec.displayName)]: delegate,
    } as unknown as Database;

    const task = buildDataRetentionTasks({ db, metricService }).find(
      t => t.name === `data-retention:${spec.displayName}`,
    );
    expect(task).toBeDefined();

    const abort = new AbortController();
    const originalDeleteMany = delegate.deleteMany.getMockImplementation()!;
    delegate.deleteMany.mockImplementation(async args => {
      const result = await originalDeleteMany(args);
      abort.abort();
      return result;
    });

    const metadata = await task!.handler(abort.signal, FAKE_TICK);

    expect(metadata).toMatchObject({
      aborted: true,
    });
    expect(delegate.deleteMany).toHaveBeenCalledTimes(1);
  });
});

function toCamelProperty(tableName: string): string {
  return tableName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
