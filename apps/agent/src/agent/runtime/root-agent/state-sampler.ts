import type { MetricClient } from "@kagami/metric-client/client";

/**
 * 状态心跳采样的 metric 名。每个采样点 value=1，tags.state = 当前状态桶
 * （appId / "wait" / "portal"）。占比由查询期 groupByTag:"state" + 归一化算出，
 * 存储层只存原始样本点（sampling profiler 语义）。
 */
export const STATE_SAMPLE_METRIC_NAME = "agent.state.sample";

type StateSamplerDeps = {
  /** 读当前状态桶（互斥单轴），来自 RootAgentSession.getCurrentStateTag。 */
  getStateTag: () => string;
  metricClient: MetricClient;
  now: () => Date;
  /** 采样间隔（ms），来自 config.server.agent.stateSampleIntervalMs。 */
  intervalMs: number;
};

/**
 * 状态心跳采样器（sampling profiler）：进程内定时器每 intervalMs 采一次「小镜此刻处于
 * 哪个状态」，打一条 value=1 的 metric。占比图 = 查询期按状态归一化。
 *
 * 为何是采样而非在状态切换边界算 dwell 时长：崩溃/重启只丢几个采样点、天然自愈，
 * 无需处理未闭合时间片；完全在 LLM 主循环之外，不碰 KV 缓存前缀。
 *
 * 精度边界（已知语义，非缺陷）：setInterval 采到的是「event loop 可调度时的时间占比」，
 * CPU-bound 长同步段会让 tick 延迟且不补采，非严格 wall-clock。对离线自观测足够。
 */
export class StateSampler {
  private readonly deps: StateSamplerDeps;
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(deps: StateSamplerDeps) {
    this.deps = deps;
  }

  /** 幂等：重复 start 只保留一个定时器。挂在 run loop 真正启动处调用。 */
  public start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      this.sampleOnce();
    }, this.deps.intervalMs);
    if (typeof this.timer.unref === "function") {
      // 不阻进程退出：采样器不该是让进程活着的理由。
      this.timer.unref();
    }
  }

  /** 幂等：停掉定时器，stop 后不再打点。挂在服务关停链调用。 */
  public stop(): void {
    if (this.timer === null) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  private sampleOnce(): void {
    // fire-and-forget：metric 摄取失败只丢点，不影响进程（record 永不 reject，这里再兜一层）。
    void this.deps.metricClient
      .record({
        metricName: STATE_SAMPLE_METRIC_NAME,
        value: 1,
        tags: { state: this.deps.getStateTag() },
        occurredAt: this.deps.now(),
      })
      .catch(() => undefined);
  }
}
