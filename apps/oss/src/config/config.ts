import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveConfigPath } from "@kagami/config/source";
import { parse } from "yaml";

export interface OssConfig {
  /** 监听端口，唯一来自 config.yaml 的 services.oss.port（服务寻址单源，见 issue #162）。 */
  port: number;
  /** 以下均为基于 repo 根算出的代码常量，非配置项。 */
  dbPath: string;
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

  return {
    port,
    dbPath: path.join(repoRoot, "data", "oss", "oss.db"),
    blobDir: path.join(repoRoot, "data", "oss", "blobs"),
    maxBodyBytes: MAX_BODY_BYTES,
  };
}
