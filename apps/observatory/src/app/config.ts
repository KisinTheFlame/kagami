import { loadStaticConfig } from "@kagami/kernel/config/config.loader";

export type ObservatoryServiceConfig = {
  /** 监听端口，来自顶层 `services.observatory.port`（单一事实来源，见 issue #162）。 */
  port: number;
  /** QQ 告警群号（PII，来自 config.secret.yaml）。 */
  alertGroupId: string;
  /** kagami-napcat 的基址（投递目标进程）。 */
  napcatBaseUrl: string;
  /** kagami-metric 的基址（打点，fire-and-forget）。 */
  metricBaseUrl: string;
};

/**
 * kagami-observatory 进程配置。
 *
 * 注意两个都叫 napcat 的配置分支别读错：
 * - `services.napcat.{host,port}` = napcat **进程端点**（本服务要的就是这个）。
 * - `server.napcat.blockedGroupIds` = 群**可见性策略**（agent 侧用；本服务不读）。
 *
 * 「告警群必须同时在 blockedGroupIds 里」这条不变量由 config.loader 的根级 superRefine 强制，
 * 配错直接拒绝启动——不靠本服务运行期检查。
 */
export async function loadObservatoryServiceConfig(): Promise<ObservatoryServiceConfig> {
  const config = await loadStaticConfig();
  const napcat = config.services.napcat;
  const metric = config.services.metric;
  return {
    port: config.services.observatory.port,
    alertGroupId: config.services.observatory.alertGroupId,
    napcatBaseUrl: `http://${napcat.host}:${napcat.port}`,
    metricBaseUrl: `http://${metric.host}:${metric.port}`,
  };
}
