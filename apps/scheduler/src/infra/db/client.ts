import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrismaClientClass,
  type PrismaClient as PrismaClientInstance,
} from "../../generated/prisma/internal/class.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// scheduler 独占的 SQLite 库（issue #493，与主库 kagami.db 物理分离）。镜像 @kagami/persistence
// 的 db client：better-sqlite3 adapter + busy_timeout + WAL + 建父目录。scheduler 独占本库，WAL
// 非必需，但与持久化包范式保持一致（也让日后有第二个读进程时不必再改）。

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

/**
 * `databaseUrl` 由 config loader 解析为绝对 `file:` URL，这里还原成 better-sqlite3 需要的绝对
 * 文件路径。`:memory:` 透传给测试使用。
 */
function sqliteFilePathFromUrl(databaseUrl: string): string {
  if (databaseUrl === ":memory:" || databaseUrl === "file::memory:") {
    return ":memory:";
  }

  if (databaseUrl.startsWith("file:")) {
    const withoutScheme = databaseUrl.slice("file:".length);
    return path.isAbsolute(withoutScheme) ? withoutScheme : fileURLToPath(new URL(databaseUrl));
  }

  return path.resolve(databaseUrl);
}
