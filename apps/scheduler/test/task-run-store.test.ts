import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SchedulerReportRunRequest } from "@kagami/scheduler-api/run";
import { TaskRunStore } from "../src/infra/db/task-run-store.js";
import { createTaskRunTestDb, type TaskRunTestDb } from "./helpers/task-run-db.js";

const RUN_ID = "run-1";

function runningRecord(over: Partial<SchedulerReportRunRequest> = {}): SchedulerReportRunRequest {
  return {
    id: RUN_ID,
    ownerId: "agent",
    taskName: "ithome-poll",
    ownerGeneration: 1_700_000_000_000,
    status: "running",
    trigger: "scheduled",
    scheduledAt: "2026-07-06T10:00:00.000Z",
    startedAt: "2026-07-06T10:00:01.000Z",
    finishedAt: null,
    durationMs: null,
    error: null,
    ...over,
  };
}

describe("TaskRunStore", () => {
  let db: TaskRunTestDb;
  let store: TaskRunStore;

  beforeEach(async () => {
    db = await createTaskRunTestDb();
    store = new TaskRunStore({ database: db.database });
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it("upserts a running run then overwrites it with the terminal state under the same id", async () => {
    await store.upsertRun(runningRecord());
    await store.upsertRun(
      runningRecord({
        status: "success",
        finishedAt: "2026-07-06T10:00:05.000Z",
        durationMs: 4000,
      }),
    );

    const rows = await db.database.taskRun.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(RUN_ID);
    expect(row.status).toBe("success");
    expect(row.finishedAt).not.toBeNull();
    expect(row.durationMs).toBe(4000);
    // 反范式化裸字段 + BigInt generation 正确落库。
    expect(row.ownerId).toBe("agent");
    expect(row.taskName).toBe("ithome-poll");
    expect(row.ownerGeneration).toBe(1_700_000_000_000n);
  });

  it("keeps distinct rows for distinct run ids", async () => {
    await store.upsertRun(runningRecord({ id: "run-a" }));
    await store.upsertRun(runningRecord({ id: "run-b" }));

    const rows = await db.database.taskRun.findMany();
    expect(rows).toHaveLength(2);
  });
});
