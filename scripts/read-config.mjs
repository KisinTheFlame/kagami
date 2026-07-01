import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveConfigPath } from "@kagami/config/source";
import { parse } from "yaml";

// 定位逻辑收敛到 @kagami/config（4 个 config reader 的单一事实来源）。只读 config.yaml
// 里的非隐私值（如 server.databaseUrl），不读 config.secret.yaml，故用 resolveConfigPath
// 直接解析基文件。
// 构建顺序：本脚本 import 已构建的 @kagami/config，因此跑 db:* 前需先 `pnpm build`
// （@kagami/config 是 yaml-only 叶子，pnpm -r build 拓扑序最先构建；app:deploy 已是 build→migrate）。

const key = process.argv[2];

if (!key) {
  throw new Error("Usage: node scripts/read-config.mjs <dot.path>");
}

const configPath = resolveConfigPath(import.meta.url);
const fileContent = await readFile(configPath, "utf8");
const config = parse(fileContent);
const value = key.split(".").reduce((current, segment) => current?.[segment], config);

if (typeof value !== "string" || value.length === 0) {
  throw new Error(`config.yaml 缺少合法的 ${key}`);
}

process.stdout.write(resolveFileUrl(value, path.dirname(configPath)));

/**
 * SQLite 的 `file:` 相对路径要按 config.yaml 所在目录解析为绝对路径，确保 Prisma CLI
 * 与运行时（config.loader.ts）落在同一个库文件上。其余值原样返回。
 */
function resolveFileUrl(rawValue, baseDir) {
  if (!rawValue.startsWith("file:")) return rawValue;
  const filePath = rawValue.slice("file:".length);
  if (filePath === ":memory:" || filePath.length === 0) return rawValue;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  return `file:${absolute}`;
}
