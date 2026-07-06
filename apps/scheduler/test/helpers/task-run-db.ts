import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, createDbClient, type Database } from "../../src/infra/db/client.js";

/**
 * 测试用 TaskRun 库：临时文件建库 + 手动跑 CREATE TABLE（与迁移 SQL 等价）。用临时文件而非
 * `:memory:`，因为 better-sqlite3 adapter 每条连接一个内存库；文件库让整套断言落在同一份数据上。
 */
export type TaskRunTestDb = {
  database: Database;
  cleanup: () => Promise<void>;
};

export async function createTaskRunTestDb(): Promise<TaskRunTestDb> {
  const dir = mkdtempSync(path.join(tmpdir(), "scheduler-task-run-"));
  const dbPath = path.join(dir, "scheduler-test.db");
  const database = createDbClient({ databaseUrl: `file:${dbPath}` });

  // 与 prisma/migrations 的初始迁移等价的建表 SQL（scheduler B P1）。
  await database.$executeRawUnsafe(`
    CREATE TABLE "task_run" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "owner_id" TEXT NOT NULL,
      "task_name" TEXT NOT NULL,
      "owner_generation" BIGINT NOT NULL,
      "status" TEXT NOT NULL,
      "trigger" TEXT NOT NULL,
      "scheduled_at" DATETIME,
      "started_at" DATETIME NOT NULL,
      "finished_at" DATETIME,
      "duration_ms" INTEGER,
      "error" TEXT,
      "reported_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await database.$executeRawUnsafe(
    `CREATE INDEX "task_run_owner_task_started_idx" ON "task_run"("owner_id", "task_name", "started_at");`,
  );

  return {
    database,
    cleanup: async () => {
      await closeDb(database);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
