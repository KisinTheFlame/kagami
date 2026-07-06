import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SchedulerReportRunRequest } from "@kagami/scheduler-api/run";
import { TaskRunStore, taskKeyString } from "../src/infra/db/task-run-store.js";
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

  describe("getRecentRunsForTasks (全局视图 #493 P4)", () => {
    async function seedRun(
      id: string,
      ownerId: string,
      taskName: string,
      startedAt: string,
      status: SchedulerReportRunRequest["status"] = "success",
    ): Promise<void> {
      await store.upsertRun(
        runningRecord({
          id,
          ownerId,
          taskName,
          status,
          startedAt,
          finishedAt: status === "running" ? null : startedAt,
          durationMs: status === "running" ? null : 1,
        }),
      );
    }

    const iso = (n: number): string => `2026-07-06T${String(n).padStart(2, "0")}:00:00.000Z`;

    it("returns empty map for empty keys without touching the db", async () => {
      const result = await store.getRecentRunsForTasks([]);
      expect(result.size).toBe(0);
    });

    it("caps each (owner, task) group at RECENT_RUNS_PER_TASK, startedAt desc", async () => {
      // taskA 塞 12 条，只应回最近 10 条（startedAt desc）。
      for (let h = 1; h <= 12; h++) {
        await seedRun(`a${h}`, "agent", "taskA", iso(h));
      }
      const result = await store.getRecentRunsForTasks([{ ownerId: "agent", taskName: "taskA" }]);
      const bucket = result.get(taskKeyString("agent", "taskA"));
      expect(bucket).toBeDefined();
      expect(bucket!.recentRuns).toHaveLength(10);
      // 首条是最新（h=12），末条是第 10 新（h=3）；h=1/2 被截掉。
      expect(bucket!.recentRuns[0]!.startedAt).toBe(iso(12));
      expect(bucket!.recentRuns[9]!.startedAt).toBe(iso(3));
    });

    it("derives isRunning from a running row and includes it in recentRuns", async () => {
      await seedRun("done", "agent", "taskA", iso(1), "success");
      await seedRun("live", "agent", "taskA", iso(2), "running");
      const result = await store.getRecentRunsForTasks([{ ownerId: "agent", taskName: "taskA" }]);
      const bucket = result.get(taskKeyString("agent", "taskA"))!;
      expect(bucket.isRunning).toBe(true);
      expect(bucket.recentRuns.map(r => r.id)).toEqual(["live", "done"]);
    });

    it("ignores a stale older running row when the newest run is terminal (rank-1 derivation)", async () => {
      // 孤儿：旧 running（终态上报丢失、从没转终态）+ 之后一次成功 run。最新一次是终态 → 任务其实
      // 已空闲，isRunning 必须 false（只看 rank-1）；旧 running 只是陈旧孤儿，不能把任务判成在跑。
      await seedRun("orphan", "agent", "taskA", iso(1), "running");
      await seedRun("later", "agent", "taskA", iso(2), "success");
      const result = await store.getRecentRunsForTasks([{ ownerId: "agent", taskName: "taskA" }]);
      const bucket = result.get(taskKeyString("agent", "taskA"))!;
      expect(bucket.isRunning).toBe(false);
      // 孤儿仍在历史里（rank-2），只是不据它判在跑。
      expect(bucket.recentRuns.map(r => r.id)).toEqual(["later", "orphan"]);
    });

    it("interrupted rows count as terminal (not running), still surface in history", async () => {
      await seedRun("gone", "agent", "taskA", iso(1), "interrupted");
      const result = await store.getRecentRunsForTasks([{ ownerId: "agent", taskName: "taskA" }]);
      const bucket = result.get(taskKeyString("agent", "taskA"))!;
      expect(bucket.isRunning).toBe(false);
      expect(bucket.recentRuns[0]!.status).toBe("interrupted");
    });

    it("partitions per (owner, task): distinct owners with same task name stay separate", async () => {
      await seedRun("x", "agent", "taskA", iso(1));
      await seedRun("y", "napcat", "taskA", iso(1));
      const result = await store.getRecentRunsForTasks([
        { ownerId: "agent", taskName: "taskA" },
        { ownerId: "napcat", taskName: "taskA" },
      ]);
      expect(result.get(taskKeyString("agent", "taskA"))!.recentRuns.map(r => r.id)).toEqual(["x"]);
      expect(result.get(taskKeyString("napcat", "taskA"))!.recentRuns.map(r => r.id)).toEqual([
        "y",
      ]);
    });

    it("omits groups that are not in the requested keys (orphan history excluded)", async () => {
      await seedRun("kept", "agent", "taskA", iso(1));
      await seedRun("orphan", "agent", "taskB", iso(1)); // owner 已删该任务，不在 keys 里
      const result = await store.getRecentRunsForTasks([{ ownerId: "agent", taskName: "taskA" }]);
      expect(result.has(taskKeyString("agent", "taskA"))).toBe(true);
      expect(result.has(taskKeyString("agent", "taskB"))).toBe(false);
    });

    it("leaves a requested key absent from the map when it has no history (left-join default)", async () => {
      await seedRun("kept", "agent", "taskA", iso(1));
      const result = await store.getRecentRunsForTasks([
        { ownerId: "agent", taskName: "taskA" },
        { ownerId: "agent", taskName: "taskNoHistory" },
      ]);
      // 无历史的活任务不入 map；调用方（handler）左连接时补 recentRuns=[] / isRunning=false。
      expect(result.has(taskKeyString("agent", "taskNoHistory"))).toBe(false);
    });
  });
});
