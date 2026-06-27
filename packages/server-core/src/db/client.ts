import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrismaClientClass,
  type PrismaClient as PrismaClientInstance,
} from "../generated/prisma/internal/class.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const PrismaClient = getPrismaClientClass();

// 锁等待超时：并发写同一 SQLite 文件时，等待持锁方释放的毫秒数，超时才抛 SQLITE_BUSY。
// 经由 better-sqlite3 的 `timeout` 选项对每条连接生效。
const SQLITE_BUSY_TIMEOUT_MS = 5000;

export type Database = PrismaClientInstance;

export function createDbClient({ databaseUrl }: { databaseUrl: string }): Database {
  const filePath = sqliteFilePathFromUrl(databaseUrl);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const adapter = new PrismaBetterSqlite3({
    url: `file:${filePath}`,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });
  return new PrismaClient({ adapter });
}

/**
 * 开启 WAL 日志模式，让 Agent 进程与管理台后端进程能并发读写同一个 SQLite 库文件而不互相阻塞。
 * WAL 是库文件级别的持久设置，设一次即长期生效；busy_timeout 已由 `createDbClient` 的
 * `timeout` 选项对每条连接生效，这里再设一次兜底。应在进程启动、拿到 db client 后调用一次。
 */
export async function configureSqlite(database: Database): Promise<void> {
  await database.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
  await database.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
}

export async function closeDb(database: Database): Promise<void> {
  await database.$disconnect();
}

/**
 * `databaseUrl` 由 config loader 解析为绝对 `file:` URL，这里还原成 better-sqlite3
 * 需要的绝对文件路径，并确保父目录存在。`:memory:` 透传给测试使用。
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
