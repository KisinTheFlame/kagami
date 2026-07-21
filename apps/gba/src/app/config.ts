import { loadStaticConfig } from "@kagami/kernel/config/config.loader";
import { MAX_ROM_BYTES } from "../application/gba.service.js";

export type GbaServiceConfig = {
  /** 监听端口，来自顶层 services.gba.port（单一事实来源，见 issue #162）。 */
  port: number;
  /** 元数据库目录（仓库根 data/gba）。 */
  dataDir: string;
  /** sqlite 文件路径（dataDir 下）。 */
  dbPath: string;
  /** OSS baseUrl（ROM 字节存取）。 */
  ossBaseUrl: string;
  /** 上传 body 上限（GBA ROM ≤32MB，取 40MB 留余量）。 */
  maxBodyBytes: number;
};

/**
 * kagami-gba 进程配置。端口取 `services.gba.port`；元数据 sqlite 落仓库根 data/gba——
 * 进程 cwd 固定仓库根（见 ecosystem.config.cjs），ROM 库与电池存档跨重启留存。
 */
export async function loadGbaServiceConfig(): Promise<GbaServiceConfig> {
  const config = await loadStaticConfig();
  return {
    port: config.services.gba.port,
    dataDir: "data/gba",
    dbPath: "data/gba/gba.db",
    ossBaseUrl: `http://${config.services.oss.host}:${config.services.oss.port}`,
    maxBodyBytes: MAX_ROM_BYTES,
  };
}
