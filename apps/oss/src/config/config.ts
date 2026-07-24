import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveConfigPath } from "@kagami/config/source";
import { parse } from "yaml";

export interface OssConfig {
  /** 监听端口，唯一来自 config.yaml 的 services.oss.port（服务寻址单源，见 issue #162）。 */
  port: number;
  /** oss 独占 SQLite 库的绝对 `file:` URL（由 config.yaml 的相对路径锚定仓库根解析而来）。 */
  databaseUrl: string;
  /** blob 目录：基于 repo 根算出的代码常量，非配置项。 */
  blobDir: string;
  maxBodyBytes: number;
}

/** body 上限是实现细节，写死为代码常量（50MB）。 */
const MAX_BODY_BYTES = 50 * 1024 * 1024;

interface RawConfig {
  services?: {
    oss?: {
      host?: string;
      port?: number;
      databaseUrl?: string;
    };
  };
}

export function loadOssConfig(): OssConfig {
  // 定位逻辑收敛到 @kagami/config；oss 只读非隐私的 services.oss，不触 config.secret.yaml。
  const configPath = resolveConfigPath(import.meta.url);
  const repoRoot = path.dirname(configPath);
  const raw = parse(readFileSync(configPath, "utf8")) as RawConfig;
  const port = raw.services?.oss?.port;
  if (typeof port !== "number") {
    throw new Error("[oss] config.yaml 缺少 services.oss.port，无法确定监听端口。");
  }
  const databaseUrl = raw.services?.oss?.databaseUrl;
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new Error("[oss] config.yaml 缺少 services.oss.databaseUrl，无法确定库文件位置。");
  }

  return {
    port,
    // 相对 `file:./...` 锚定到 config.yaml 所在目录（仓库根），与 Prisma CLI（迁移建表的库）
    // 落在同一文件——缺了这步，相对路径在 client 侧经 new URL() 会解析到文件系统根。
    databaseUrl: resolveSqliteFileUrl(repoRoot, databaseUrl),
    blobDir: path.join(repoRoot, "data", "oss", "blobs"),
    maxBodyBytes: MAX_BODY_BYTES,
  };
}

/**
 * 将 config 中相对仓库根的 SQLite 路径解析为绝对 `file:` URL。只处理 `file:` 路径；
 * `file::memory:` 与其它 scheme 原样返回（镜像 config.loader.ts 的 resolveSqliteFileUrl，
 * oss 走自有 minimal loader 故就地复刻这一小段）。
 */
function resolveSqliteFileUrl(baseDir: string, value: string): string {
  if (!value.startsWith("file:") || value === "file::memory:") {
    return value;
  }
  const raw = value.slice("file:".length);
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw);
  return `file:${absolute}`;
}
