import type { SchedulerReportRunRequest } from "@kagami/scheduler-api/run";
import type { Database } from "./client.js";

type TaskRunStoreDeps = {
  database: Database;
};

/**
 * TaskRun 执行历史存储（issue #493 P1）。scheduler 独占的 Prisma 库，按 runId 幂等 upsert：
 * 同一 id 先后到（running → 终态）只留一行，终态覆盖 running。wire 层的 ISO 字符串在这里转成
 * Date，number 型 ownerGeneration 转成 BigInt 落库。
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

    await this.database.taskRun.upsert({
      where: { id: record.id },
      create: { id: record.id, ...data },
      update: data,
    });
  }
}

/** wire 的 ISO 字符串（可空 / 可缺省）转 Date；缺省与 null 一律落 null。 */
function toDateOrNull(value: string | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}
