import { mkdirSync } from "node:fs";
import { sqliteFilePathFromUrl } from "@kagami/kernel/utils/sqlite-path";
import path from "node:path";
import {
  getPrismaClientClass,
  type PrismaClient as PrismaClientInstance,
} from "../../generated/prisma/internal/class.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// napcat 独占的 SQLite 库（epic #539 子 issue 2，与主库 kagami.db 物理分离）。镜像
// @kagami/persistence 的 db client：better-sqlite3 adapter + busy_timeout + WAL + 建父目录。
// napcat 独占本库，WAL 非必需，但与持久化包范式保持一致。

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
 * 开启 WAL 日志模式并兜底 busy_timeout。库文件级持久设置，进程启动拿到 client 后调用一次即可。
 * 两条 PRAGMA 故意分开调用：`$queryRawUnsafe` 经 adapter 走 prepared statement，一次只执行第一条
 * 语句，拼进同一字符串会静默丢弃第二条。
 */
export async function configureSqlite(database: Database): Promise<void> {
  await database.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await database.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}

export async function closeDb(database: Database): Promise<void> {
  await database.$disconnect();
}
