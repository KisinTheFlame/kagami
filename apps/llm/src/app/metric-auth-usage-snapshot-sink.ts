import type {
  AuthUsageRefreshOutcome,
  AuthUsageSnapshotSink,
  AuthUsageSnapshotSinkRecord,
} from "@kagami/auth";
import type { MetricClient } from "@kagami/metric-client/client";

/** OAuth 额度剩余百分比 gauge（0-100），tags `{provider, window}`，图表用 raw / last。 */
export const OAUTH_QUOTA_REMAINING_PERCENT_METRIC = "llm.oauth.quota.remaining_percent";
/** OAuth 额度采集成败（1/0），tag `{provider}`，用于区分「没数据」与「采集挂了」。 */
export const OAUTH_QUOTA_REFRESH_SUCCESS_METRIC = "llm.oauth.quota.refresh_success";

type MetricAuthUsageSnapshotSinkDeps = {
  metricClient: MetricClient;
};

/**
 * 把 packages/auth 的额度遥测事件翻成 Metric 打点（epic #521）。auth 领域包只认窄端口
 * AuthUsageSnapshotSink，这里是 apps/llm 侧的 Metric 适配实现。record 是 fire-and-forget
 * （HttpMetricClient 咽下一切失败、永不 reject），端口方法为同步 void，故一律 `void`。
 */
export class MetricAuthUsageSnapshotSink implements AuthUsageSnapshotSink {
  private readonly metricClient: MetricClient;

  public constructor({ metricClient }: MetricAuthUsageSnapshotSinkDeps) {
    this.metricClient = metricClient;
  }

  public record(input: AuthUsageSnapshotSinkRecord): void {
    void this.metricClient
      .record({
        metricName: OAUTH_QUOTA_REMAINING_PERCENT_METRIC,
        value: input.remainingPercent,
        tags: { provider: input.provider, window: input.window },
        occurredAt: input.capturedAt,
      })
      .catch(() => undefined);
  }

  public recordRefreshOutcome(input: AuthUsageRefreshOutcome): void {
    void this.metricClient
      .record({
        metricName: OAUTH_QUOTA_REFRESH_SUCCESS_METRIC,
        value: input.success ? 1 : 0,
        tags: { provider: input.provider },
      })
      .catch(() => undefined);
  }
}
