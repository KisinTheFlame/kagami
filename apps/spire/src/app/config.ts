import { loadStaticConfig } from "@kagami/kernel/config/config.loader";

export type SpireServiceConfig = {
  /** 监听端口，来自顶层 services.spire.port（单一事实来源，见 issue #162）。 */
  port: number;
  /** 存档目录（仓库根 data/spire）。 */
  saveDir: string;
};

/**
 * kagami-spire 进程配置。端口取 `services.spire.port`；存档落仓库根 data/spire——
 * 进程 cwd 固定仓库根（见 ecosystem.config.cjs），对局跨 agent / 本进程重启留存。
 */
export async function loadSpireServiceConfig(): Promise<SpireServiceConfig> {
  const config = await loadStaticConfig();
  return {
    port: config.services.spire.port,
    saveDir: "data/spire",
  };
}
