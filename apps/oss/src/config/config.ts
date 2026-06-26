import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface OssConfig {
  /** 仅此一项来自 config.yaml（运维可能撞端口 / 想挪）。 */
  port: number;
  /** 以下均为基于 repo 根算出的代码常量，非配置项。 */
  dbPath: string;
  blobDir: string;
  maxBodyBytes: number;
}

/** 唯一配置项缺省值；config.yaml 通常会显式给出 oss.port。 */
const DEFAULT_PORT = 20005;
/** body 上限是实现细节，写死为代码常量（50MB）。 */
const MAX_BODY_BYTES = 50 * 1024 * 1024;

interface RawConfig {
  oss?: {
    port?: number;
  };
}

/**
 * 复刻 server 的锚点法定位仓库根，保证 data/oss 落在仓库根而非 PM2 给的 cwd（apps/oss）下。
 * 候选顺序：当前 cwd → cwd/../../（PM2 以 apps/oss 为 cwd 时命中）→ 相对本文件 dist 位置上溯。
 * 找不到 config.yaml 时**响亮失败**，绝不静默回退到 cwd（那正是会把库建错位置的坑）。
 */
function resolveRepoRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "config.yaml"),
    path.resolve(process.cwd(), "../../config.yaml"),
    fileURLToPath(new URL("../../../../config.yaml", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return path.dirname(candidate);
    }
  }

  throw new Error(
    "[oss] 未找到 config.yaml，无法确定仓库根，拒绝在错误位置建库。请在仓库根或 apps/oss 下启动。",
  );
}

export function loadOssConfig(): OssConfig {
  const repoRoot = resolveRepoRoot();
  const raw = parse(readFileSync(path.join(repoRoot, "config.yaml"), "utf8")) as RawConfig;
  const port = raw.oss?.port ?? DEFAULT_PORT;

  return {
    port,
    dbPath: path.join(repoRoot, "data", "oss", "oss.db"),
    blobDir: path.join(repoRoot, "data", "oss", "blobs"),
    maxBodyBytes: MAX_BODY_BYTES,
  };
}
