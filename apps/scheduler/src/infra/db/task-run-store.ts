import type { SchedulerReportRunRequest } from "@kagami/scheduler-api/run";
import type { Database } from "./client.js";

type TaskRunStoreDeps = {
  database: Database;
};

type PruneHistoryOptions = {
  retentionCount: number;
  retentionDays: number;
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
