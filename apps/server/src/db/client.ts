import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrismaClientClass,
  type PrismaClient as PrismaClientInstance,
} from "../generated/prisma/internal/class.js";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const PrismaClient = getPrismaClientClass();

export type Database = PrismaClientInstance;

export function createDbClient({ databaseUrl }: { databaseUrl: string }): Database {
  const filePath = sqliteFilePathFromUrl(databaseUrl);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const adapter = new PrismaBetterSqlite3({ url: `file:${filePath}` });
  return new PrismaClient({ adapter });
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
