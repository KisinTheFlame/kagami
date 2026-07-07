// OAuth 额度遥测的下沉端口（epic #521）。packages/auth 是认证/额度领域包，Metric 是宿主应用的观测
// 设施——领域包不该反向依赖 @kagami/metric-client。故这里只定义一个窄端口，由宿主（apps/llm）注入
// Metric 实现；默认 noop，测试与未装配时零副作用。
//
// window / provider 取值故意在本文件自持（不引 @kagami/llm-api/auth-usage-trend）：那条趋势契约在
// epic 收尾（#520）会被整条删除，sink 不该跟它耦合。

export type AuthUsageMetricProvider = "claude-code" | "openai-codex";
export type AuthUsageMetricWindow = "five_hour" | "seven_day";

/** 一次成功采集里某个 (provider, window) 的额度剩余百分比快照。 */
export type AuthUsageSnapshotSinkRecord = {
  provider: AuthUsageMetricProvider;
  window: AuthUsageMetricWindow;
  /** 剩余百分比 0-100。 */
  remainingPercent: number;
  capturedAt: Date;
};

/** 一轮刷新对某 provider 的采集结果：success=false 用于区分「采集挂了」与「没数据」。 */
export type AuthUsageRefreshOutcome = {
  provider: AuthUsageMetricProvider;
  success: boolean;
};

export interface AuthUsageSnapshotSink {
  /** 上报某窗口的剩余额度。fire-and-forget，实现绝不 throw。 */
  record(input: AuthUsageSnapshotSinkRecord): void;
  /** 上报某 provider 本轮采集成功/失败。fire-and-forget，实现绝不 throw。 */
  recordRefreshOutcome(input: AuthUsageRefreshOutcome): void;
}

export const NOOP_AUTH_USAGE_SNAPSHOT_SINK: AuthUsageSnapshotSink = {
  record: () => undefined,
  recordRefreshOutcome: () => undefined,
};
