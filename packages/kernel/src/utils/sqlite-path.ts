import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 把 config loader 解析出的绝对 `file:` URL 还原成 better-sqlite3 需要的绝对文件路径。
 * `:memory:` 透传给测试使用。
 *
 * epic #539 子 issue 5 抽提：此前逐字复制在 persistence / scheduler / napcat / llm 四个
 * db client 里——纯路径逻辑无 Prisma 绑定（各包 client 因绑定各自 generated PrismaClient
 * 必须分立，属结构性约束；本函数没有），收敛到 kernel 单点维护。
 */
export function sqliteFilePathFromUrl(databaseUrl: string): string {
  if (databaseUrl === ":memory:" || databaseUrl === "file::memory:") {
    return ":memory:";
  }

  if (databaseUrl.startsWith("file:")) {
    const withoutScheme = databaseUrl.slice("file:".length);
    return path.isAbsolute(withoutScheme) ? withoutScheme : fileURLToPath(new URL(databaseUrl));
  }

  return path.resolve(databaseUrl);
}
