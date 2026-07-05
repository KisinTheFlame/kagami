import { loadStaticConfig } from "@kagami/kernel/config/config.loader";

export type PixelServiceConfig = {
  /** 监听端口，来自顶层 services.pixel.port（单一事实来源，见 issue #162）。 */
  port: number;
  /** 存档目录（仓库根 data/pixel）。 */
  saveDir: string;
};

/**
 * kagami-pixel 进程配置。端口取 `services.pixel.port`；存档落仓库根 data/pixel——
 * 进程 cwd 固定仓库根（见 ecosystem.config.cjs），画布跨 agent / 本进程重启留存。
 */
export async function loadPixelServiceConfig(): Promise<PixelServiceConfig> {
  const config = await loadStaticConfig();
  return {
    port: config.services.pixel.port,
    saveDir: "data/pixel",
  };
}
