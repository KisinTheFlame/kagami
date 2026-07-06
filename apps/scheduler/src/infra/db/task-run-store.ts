import { RECENT_RUNS_PER_TASK, type SchedulerTaskViewRun } from "@kagami/scheduler-api/tasks-view";
import type { SchedulerReportRunRequest } from "@kagami/scheduler-api/run";
import type { SchedulerRunStatus, SchedulerRunTrigger } from "@kagami/scheduler-api/run";
import type { Database } from "./client.js";

type TaskRunStoreDeps = {
  database: Database;
};

type PruneHistoryOptions = {
  retentionCount: number;
  retentionDays: number;
};

/** (ownerId, taskName) 复合键：全局视图左连接活任务与执行历史用。 */
export type TaskKey = {
  ownerId: string;
  taskName: string;
};

/** 一个 (ownerId, taskName) 分组的历史投影：最近 N 条 run + 是否有 running 行。 */
export type TaskRunHistory = {
  recentRuns: SchedulerTaskViewRun[];
  isRunning: boolean;
};

/** window function 选出的一行原始 run（rank ≤ N）。SQLite 驱动回的裸标量，手动映射到 wire。 */
type RankedRunRow = {
  owner_id: string;
  task_name: string;
  id: string;
  status: string;
  trigger: string;
  scheduled_at: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
};

/**
 * TaskRun 执行历史存储（issue #493）。scheduler 独占的 Prisma 库，按 runId 幂等 upsert。
 *
 * P2 状态感知：上报乱序/重试可能让迟到的 running 抹回已写入的终态。故按 request.status 分支——
 * - running：**存在即不覆盖**（空 update：缺则建、已存在 no-op），迟到 running 绝不覆盖已有行。
 * - 终态（success/failure/interrupted）：完整 upsert（缺则建、已存在全字段覆盖），终态永远赢。
 *
 * wire 层的 ISO 字符串在这里转成 Date，number 型 ownerGeneration 转成 BigInt 落库。
 */
export class TaskRunStore {
  private readonly database: Database;

  public constructor({ database }: TaskRunStoreDeps) {
    this.database = database;
  }

  public async upsertRun(record: SchedulerReportRunRequest): Promise<void> {
    const data = {
      ownerId: record.ownerId,
      taskName: record.taskName,
      ownerGeneration: BigInt(record.ownerGeneration),
      status: record.status,
      trigger: record.trigger,
      scheduledAt: toDateOrNull(record.scheduledAt),
      startedAt: new Date(record.startedAt),
      finishedAt: toDateOrNull(record.finishedAt),
      durationMs: record.durationMs ?? null,
      error: record.error ?? null,
    };

    // running 上报：迟到到达的 running 绝不覆盖已有的 running/终态，故 update 留空（no-op）。
    // 终态上报：终态永远赢，缺则建、已存在全字段覆盖。
    await this.database.taskRun.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data },
      update: record.status === "running" ? {} : data,
    });
  }

  /**
   * 批量查一组 (ownerId, taskName) 的执行历史投影（全局视图 #493 P4）：每个分组的最近
   * RECENT_RUNS_PER_TASK 条 run（startedAt desc）+ 是否有 running 行。
   *
   * 避免 N+1：用一条 window function SQL（ROW_NUMBER() OVER PARTITION BY owner_id, task_name
   * ORDER BY started_at DESC, id DESC，取 rank ≤ N）一次拉全部分组的近期 runs，进程内按 key
   * 桶排。isRunning **只看每组 rank-1（最近一次 run）是否 running**——真正在跑的 run 必是最新一次
   * （见循环内注释）；rank>1 的 running 行是漏报终态的陈旧孤儿，不算在跑。空组（无历史）不入 map，
   * 由调用方左连接补 recentRuns=[] / isRunning=false。
   *
   * keys 为空时直接回空 map（跳过 SQL）。keys 由 engine 活任务派生，个数=活任务数（十几个量级），
   * 不做参数分批。
   */
  public async getRecentRunsForTasks(keys: TaskKey[]): Promise<Map<string, TaskRunHistory>> {
    const result = new Map<string, TaskRunHistory>();
    if (keys.length === 0) {
      return result;
    }

    // (owner_id, task_name) IN ((?,?), (?,?), ...)：只捞活任务分组的行，孤儿历史（owner 已删该
    // 任务）不进 window，也就不进视图。
    const tuplePlaceholders = keys.map(() => "(?, ?)").join(", ");
    const params: (string | number)[] = [];
    for (const key of keys) {
      params.push(key.ownerId, key.taskName);
    }
    params.push(RECENT_RUNS_PER_TASK);

    const rows = await this.database.$queryRawUnsafe<RankedRunRow[]>(
      `
      SELECT
        "owner_id", "task_name", "id", "status", "trigger",
        "scheduled_at", "started_at", "finished_at", "duration_ms", "error"
      FROM (
        SELECT
          "owner_id", "task_name", "id", "status", "trigger",
          "scheduled_at", "started_at", "finished_at", "duration_ms", "error",
          ROW_NUMBER() OVER (
            PARTITION BY "owner_id", "task_name"
            ORDER BY "started_at" DESC, "id" DESC
          ) AS "rank"
        FROM "task_run"
        WHERE ("owner_id", "task_name") IN (${tuplePlaceholders})
      )
      WHERE "rank" <= ?
      ORDER BY "owner_id", "task_name", "started_at" DESC, "id" DESC
      `,
      ...params,
    );

    for (const row of rows) {
      const key = taskKeyString(row.owner_id, row.task_name);
      let bucket = result.get(key);
      if (!bucket) {
        // 首行即该分组 rank-1（最近一次 run，rows 已按 started_at DESC, id DESC 排序）。isRunning
        // **只看 rank-1**：真正在跑的 run 必是最新一次（SDK running 锁保证同任务同时只有一个、且其
        // started_at 最新）；rank>1 的 running 行只可能是「终态上报丢失」的陈旧孤儿，不代表任务在跑，
        // 不据它判 isRunning（否则一个漏报终态的旧 run 会把已空闲的任务永远显示成运行中）。
        bucket = { recentRuns: [], isRunning: row.status === "running" };
        result.set(key, bucket);
      }
      bucket.recentRuns.push(toViewRun(row));
    }

    return result;
  }

  /**
   * owner 带更大 generation 重连时，把上一代还挂着 running 的行标 interrupted（#493 P2）。
   * 只标 `owner_generation < generation` 的行：同代重连（scheduler 重启、agent 存活、generation
   * 不变）不误杀正在跑的 run；agent 重启（generation 递增）才标上一代残留。
   */
  public async markInterruptedBelow(ownerId: string, generation: number): Promise<void> {
    await this.database.taskRun.updateMany({
      where: {
        ownerId,
        status: "running",
        ownerGeneration: { lt: BigInt(generation) },
      },
      data: {
        status: "interrupted",
        finishedAt: new Date(),
      },
    });
  }

  /**
   * 历史 GC（#493 P2）。删除一条当且仅当 **(在其 (owner_id, task_name) 分组内按 started_at desc
   * 排名 > N) 或 (started_at 早于 now - days)**，即保留「排名≤N 且 days 内」。绝不删 running 行。
   * 用一条 SQL（window function）选出超额行，与超期行做并集后 DELETE，避免 N+1。
   */
  public async pruneHistory({ retentionCount, retentionDays }: PruneHistoryOptions): Promise<void> {
    const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);
    // running 行永不删（NOT ('running')）。超额（rank > N）与超期（started_at < cutoff）取并集删。
    await this.database.$executeRawUnsafe(
      `
      DELETE FROM "task_run"
      WHERE "status" <> 'running'
        AND "id" IN (
          SELECT "id" FROM (
            SELECT
              "id",
              "started_at",
              ROW_NUMBER() OVER (
                PARTITION BY "owner_id", "task_name"
                ORDER BY "started_at" DESC, "id" DESC
              ) AS "rank"
            FROM "task_run"
            WHERE "status" <> 'running'
          )
          WHERE "rank" > ? OR "started_at" < ?
        )
      `,
      retentionCount,
      cutoff.toISOString(),
    );
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** wire 的 ISO 字符串（可空 / 可缺省）转 Date；缺省与 null 一律落 null。 */
function toDateOrNull(value: string | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}

/**
 * 合成 (ownerId, taskName) 复合键的 map 键；调用方与桶排两侧共用，保证一致。用 JSON 元组而非裸
 * 分隔符：ownerId/taskName 里的任何字符（含分隔符本身）都被 JSON 转义，两个不同 (owner,task) 绝不
 * 拼成同一键——比曾用的 U+0000 分隔符稳，也不在源码里放字面 NUL。
 */
export function taskKeyString(ownerId: string, taskName: string): string {
  return JSON.stringify([ownerId, taskName]);
}

/**
 * SQLite DATETIME 列经 better-sqlite3 adapter 回来是 JS Date（见探测）；也兼容驱动升级后回 ISO
 * 字符串的情形。null 透传 null，统一归一成 wire 的 ISO 字符串。
 */
function toIsoOrNull(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** window function 选出的裸行映射到 wire 的 SchedulerTaskViewRun（时间归一 ISO、状态/来源收窄）。 */
function toViewRun(row: RankedRunRow): SchedulerTaskViewRun {
  return {
    id: row.id,
    status: row.status as SchedulerRunStatus,
    trigger: row.trigger as SchedulerRunTrigger,
    scheduledAt: toIsoOrNull(row.scheduled_at),
    // started_at NOT NULL：归一后必非空，兜底空串仅为收窄类型（实际不触达）。
    startedAt: toIsoOrNull(row.started_at) ?? "",
    finishedAt: toIsoOrNull(row.finished_at),
    durationMs: row.duration_ms,
    error: row.error,
  };
}
