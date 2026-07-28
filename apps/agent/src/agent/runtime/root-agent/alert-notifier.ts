import type { RaiseAlertRequest } from "@kagami/observatory-api/alert";

/**
 * 告警上报端口（issue #602）。收**通用**告警载荷而不是 agent 专有类型——这样 agent 里将来别的
 * 告警源（毒上下文挂起、工具持续失败…）可以复用同一个端口，不必各自造一个通知器。
 *
 * 实现是 `@kagami/observatory-client` 的 `HttpObservatoryClient`（#608 起从 agent 的 ACL
 * 搬进公共包，让所有服务都能告警）。
 *
 * 契约：**永不 reject**。调用点是 `void notifier.raise(...)`，reject 会变成
 * unhandledRejection 把 agent 进程拉挂——告警绝不能反过来杀掉被告警的东西。
 */
export type AlertNotifier = {
  raise(alert: RaiseAlertRequest): Promise<void>;
};

/** 未配置 observatory / 测试用的 null-object（照 NOOP_METRIC_CLIENT 范式）。 */
export const NOOP_ALERT_NOTIFIER: AlertNotifier = {
  async raise(): Promise<void> {
    // no-op
  },
};
