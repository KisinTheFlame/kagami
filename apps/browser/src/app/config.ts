import { z } from "zod";
import { loadStaticConfig } from "@kagami/kernel/config/config.loader";

/**
 * 浏览器行为配置。只有这 4 个字段是环境相关的（headless / userDataDir / proxy /
 * licenseKey）；humanize / viewport / 超时 / 截图尺寸等是 BrowserService 里的代码常量，
 * 不进 config（config-yaml-is-for-ops-not-code）。
 *
 * 与 agent 侧 BrowserApp.configSchema 同构：浏览器行为配置仍写在 `server.apps.browser`，
 * 拆分后由本进程消费，agent 侧只用它过 App 框架的 config 校验、不再读值。
 */
const BrowserBehaviorConfigSchema = z
  .object({
    headless: z.boolean().default(false),
    userDataDir: z.string().min(1).default("data/browser/default"),
    proxy: z.string().min(1).optional(),
    licenseKey: z.string().min(1).optional(),
  })
  .default({});

type BrowserBehaviorConfig = z.infer<typeof BrowserBehaviorConfigSchema>;

export type BrowserProcessConfig = {
  /** 监听端口，来自顶层 services.browser.port（单一事实来源，见 issue #162）。 */
  port: number;
  databaseUrl: string;
  browser: BrowserBehaviorConfig;
};

/**
 * 读取并校验本进程配置。监听端口取 `services.browser.port`；浏览器行为取
 * `server.apps.browser`（unknown 切片，这里用 schema 二次校验）。userDataDir 仍按
 * 进程 cwd 解析——kagami-browser 的 PM2 cwd 固定为仓库根，故落在仓库根 `data/browser/`
 * （见 issue #173 的 userDataDir 锚定 + 一次性迁移）。
 */
export async function loadBrowserProcessConfig(): Promise<BrowserProcessConfig> {
  const config = await loadStaticConfig();
  const browser = BrowserBehaviorConfigSchema.parse(config.server.apps.browser ?? {});
  return {
    port: config.services.browser.port,
    databaseUrl: config.server.databaseUrl,
    browser,
  };
}
