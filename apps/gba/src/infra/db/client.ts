import { mkdirSync } from "node:fs";
import { sqliteFilePathFromUrl } from "@kagami/kernel/utils/sqlite-path";
import path from "node:path";
import {
  getPrismaClientClass,
  type PrismaClient as PrismaClientInstance,
} from "../../generated/prisma/internal/class.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// gba 独占的 SQLite 库（rom / battery_save / run_state / resume_state）。镜像 @kagami/persistence
// 的 db client：better-sqlite3 adapter + busy_timeout + WAL + 建父目录。gba 独占本库。

// 锁等待超时：并发写同一 SQLite 文件时，等待持锁方释放的毫秒数，超时才抛 SQLITE_BUSY。
const SQLITE_BUSY_TIMEOUT_MS = 5000;

export type Database = PrismaClientInstance;

const PrismaClient = getPrismaClientClass();

export function createDbClient({ databaseUrl }: { databaseUrl: string }): Database {
  const filePath = sqliteFilePathFromUrl(databaseUrl);
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const adapter = new PrismaBetterSqlite3({
    url: `file:${filePath}`,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });
  return new PrismaClient({ adapter });
}

/**
 * 开启 WAL、兜底 busy_timeout，并打开 FK 强制。库文件级持久设置，进程启动拿到 client 后调用一次即可。
 * 三条 PRAGMA 故意分开调用：`$queryRawUnsafe` 经 adapter 走 prepared statement，一次只执行第一条
 * 语句，拼进同一字符串会静默丢弃后续。foreign_keys 是每连接会话级设置（非持久），须每次开库都设——
 * deleteRom 依赖 DB 级 `ON DELETE CASCADE`（battery_save / resume_state）与 `ON DELETE SET NULL`
 * （run_state）级联，必须开 FK 才生效（裸 better-sqlite3 时代也一直 `foreign_keys = ON`）。
 */
export async function configureSqlite(database: Database): Promise<void> {
  await database.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await database.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
  await database.$queryRawUnsafe("PRAGMA foreign_keys = ON;");
}

export async function closeDb(database: Database): Promise<void> {
  await database.$disconnect();
}
