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

  it("does not let a late running report overwrite an already-written terminal state", async () => {
    // 先终态 success，再迟到 running（乱序到达）：终态不被退回。
    await store.upsertRun(
      runningRecord({
        status: "success",
        finishedAt: "2026-07-06T10:00:05.000Z",
        durationMs: 4000,
      }),
    );
    await store.upsertRun(runningRecord()); // 迟到的 running 上报，同 id

    const rows = await db.database.taskRun.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("success");
    expect(rows[0]!.finishedAt).not.toBeNull();
    expect(rows[0]!.durationMs).toBe(4000);
  });

  describe("markInterruptedBelow", () => {
    async function seedRunning(id: string, generation: number): Promise<void> {
      await store.upsertRun(runningRecord({ id, ownerGeneration: generation }));
    }

    it("marks stale-generation running rows interrupted, spares same/newer generations", async () => {
      await seedRunning("old", 100);
      await seedRunning("same", 200);
      await store.upsertRun(
        runningRecord({ id: "other-owner", ownerId: "napcat", ownerGeneration: 100 }),
      );

      // agent 带 generation=200 重连：只标 generation < 200 且 status=running 的 agent 行。
      await store.markInterruptedBelow("agent", 200);

      const byId = new Map((await db.database.taskRun.findMany()).map(r => [r.id, r] as const));
      expect(byId.get("old")!.status).toBe("interrupted");
      expect(byId.get("old")!.finishedAt).not.toBeNull();
      // 同代（200 不 < 200）不误杀；别的 owner 也不动。
      expect(byId.get("same")!.status).toBe("running");
      expect(byId.get("other-owner")!.status).toBe("running");
    });

    it("does not touch terminal rows even from older generations", async () => {
      await store.upsertRun(
        runningRecord({
          id: "done",
          ownerGeneration: 100,
          status: "success",
          finishedAt: "2026-07-06T10:00:05.000Z",
          durationMs: 4000,
        }),
      );
      await store.markInterruptedBelow("agent", 200);
      const row = (await db.database.taskRun.findMany())[0]!;
      expect(row.status).toBe("success");
    });
  });

  describe("pruneHistory", () => {
    async function seed(
      id: string,
      taskName: string,
      startedAt: string,
      status = "success",
    ): Promise<void> {
      await store.upsertRun(
        runningRecord({
          id,
          taskName,
          status: status as "success",
          startedAt,
          finishedAt: startedAt,
          durationMs: 1,
        }),
      );
    }

    it("keeps only the most recent N per (owner, task) and drops rows older than the window", async () => {
      const now = Date.now();
      const iso = (offsetDays: number): string =>
        new Date(now - offsetDays * 24 * 60 * 60 * 1000).toISOString();

      // taskA：4 条近期（0/1/2/3 天前），保留最近 N=2 → 删 2 条最旧的（rank>2）。
      await seed("a0", "taskA", iso(0));
      await seed("a1", "taskA", iso(1));
      await seed("a2", "taskA", iso(2));
      await seed("a3", "taskA", iso(3));
      // taskB：1 条超期（100 天前）→ 按天数删。
      await seed("b0", "taskB", iso(100));
      // running 行超期也不删。
      await store.upsertRun(
        runningRecord({ id: "r0", taskName: "taskC", status: "running", startedAt: iso(200) }),
      );

      await store.pruneHistory({ retentionCount: 2, retentionDays: 90 });

      const ids = new Set((await db.database.taskRun.findMany()).map(r => r.id));
      // taskA 只留最近 2 条。
      expect(ids.has("a0")).toBe(true);
      expect(ids.has("a1")).toBe(true);
      expect(ids.has("a2")).toBe(false);
      expect(ids.has("a3")).toBe(false);
      // taskB 超期被删。
      expect(ids.has("b0")).toBe(false);
      // running 行永不删。
      expect(ids.has("r0")).toBe(true);
    });

    it("deletes a within-count row that is nonetheless older than the day window", async () => {
      const now = Date.now();
      const iso = (offsetDays: number): string =>
        new Date(now - offsetDays * 24 * 60 * 60 * 1000).toISOString();
      // 组内仅 1 条（rank=1，未超额），但超过天数窗 → 仍删（并集语义）。
      await seed("old", "taskA", iso(100));
      await store.pruneHistory({ retentionCount: 200, retentionDays: 90 });
      expect(await db.database.taskRun.findMany()).toHaveLength(0);
    });
  });
});
