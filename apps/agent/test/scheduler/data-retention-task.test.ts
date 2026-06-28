import { describe, expect, it, vi } from "vitest";
import type { Database } from "@kagami/server-core/db/client";
import type { MetricService } from "../../src/metric/application/metric.service.js";
import { buildDataRetentionTasks } from "../../src/scheduler/tasks/data-retention/data-retention-task.factory.js";
import { RETENTION_TASKS } from "../../src/scheduler/tasks/data-retention/retention-tasks.js";

function makeMetricService(): MetricService {
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
  it("registers exactly one task per retention spec", () => {
    const metricService = makeMetricService();
    const db = {} as Database;
    const tasks = buildDataRetentionTasks({ db, metricService });
    expect(tasks).toHaveLength(RETENTION_TASKS.length);
    expect(tasks.map(t => t.name)).toEqual(
      RETENTION_TASKS.map(spec => `data-retention:${spec.displayName}`),
    );
  });

  it("each task uses a staggered cron at 00:<offset>", () => {
    const tasks = buildDataRetentionTasks({
      db: {} as Database,
      metricService: makeMetricService(),
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
    const metricService = makeMetricService();
    const spec = RETENTION_TASKS[0]!;
    const delegate = makeDelegate(12_000);

    const db = {
      [toCamelProperty(spec.displayName)]: delegate,
    } as unknown as Database;

    // Override getDelegate so we use our fake regardless of spec wiring.
    const task = buildDataRetentionTasks({
      db,
      metricService,
    }).find(t => t.name === `data-retention:${spec.displayName}`);
    expect(task).toBeDefined();

    // The spec's getDelegate accesses db[spec.displayName camelCase]; we patched that above.
    const abort = new AbortController();
    const metadata = await task!.run(abort.signal);

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
    const metricService = makeMetricService();
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
    // Abort after the first chunk is processed by using setImmediate inside.
    const originalDeleteMany = delegate.deleteMany.getMockImplementation()!;
    delegate.deleteMany.mockImplementation(async args => {
      const result = await originalDeleteMany(args);
      abort.abort();
      return result;
    });

    const metadata = await task!.run(abort.signal);

    expect(metadata).toMatchObject({
      aborted: true,
    });
    expect(delegate.deleteMany).toHaveBeenCalledTimes(1);
  });
});

function toCamelProperty(tableName: string): string {
  return tableName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
