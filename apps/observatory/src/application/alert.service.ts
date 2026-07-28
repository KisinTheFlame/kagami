import { AppLogger } from "@kagami/kernel/logger/logger";
import { NOOP_METRIC_CLIENT, type MetricClient } from "@kagami/metric-client/client";
import type { RaiseAlertRequest, RaiseAlertResponse } from "@kagami/observatory-api/alert";
import type { AlertChannel } from "../domain/alert-channel.js";
import { renderAlertMessage } from "../domain/alert-message.js";
import type { AlertThrottle } from "./alert-throttle.js";

/** 告警量 + 通道健康的时间序列。outcome 三态覆盖全部结局。 */
const OBSERVATORY_ALERT_RAISED_METRIC = "observatory.alert.raised";

const logger = new AppLogger({ source: "observatory.alert-service" });

/**
 * 告警编排：限流 → 渲染 → 投递。
 *
 * 三条不变量：
 * 1. **永不外抛**。投递失败归一成 `{ delivered: false, suppressed: false }`（HTTP 200）——那不是
 *    调用方的错，调用方也不该重试。
 * 2. **投递失败也记日志**：告警发不出去时，observatory 自己的 PM2 日志是最后一道痕。
 * 3. **metric 是旁路**：打点抛错绝不影响返回值与投递（fire-and-forget + catch）。
 */
export class AlertService {
  private readonly channel: AlertChannel;
  private readonly throttle: AlertThrottle;
  private readonly metricService: MetricClient;
  private readonly now: () => Date;

  public constructor({
    channel,
    throttle,
    metricService,
    now,
  }: {
    channel: AlertChannel;
    throttle: AlertThrottle;
    metricService?: MetricClient;
    now?: () => Date;
  }) {
    this.channel = channel;
    this.throttle = throttle;
    this.metricService = metricService ?? NOOP_METRIC_CLIENT;
    this.now = now ?? (() => new Date());
  }

  public async raise(alert: RaiseAlertRequest): Promise<RaiseAlertResponse> {
    const decision = this.throttle.admit({ source: alert.source, event: alert.event });
    if (!decision.admit) {
      logger.info("Alert suppressed by dedupe window", {
        event: "observatory.alert.suppressed",
        source: alert.source,
        alertEvent: alert.event,
        severity: alert.severity,
      });
      this.recordMetric(alert, "suppressed");
      return { delivered: false, suppressed: true };
    }

    const message = renderAlertMessage({
      alert,
      occurredAt: this.now(),
      suppressedSinceLast: decision.suppressedSinceLast,
    });

    try {
      await this.channel.deliver(message);
    } catch (error) {
      // 通道失败不是调用方的错，也不重试（重试只会加重下游压力）。窗口已开，5 分钟内同类
      // 告警仍被压制——见 AlertThrottle 的「以尝试为界」取舍。
      logger.errorWithCause("Alert delivery failed", error, {
        event: "observatory.alert.delivery_failed",
        source: alert.source,
        alertEvent: alert.event,
        severity: alert.severity,
      });
      this.recordMetric(alert, "failed");
      return { delivered: false, suppressed: false };
    }

    logger.info("Alert delivered", {
      event: "observatory.alert.delivered",
      source: alert.source,
      alertEvent: alert.event,
      severity: alert.severity,
      suppressedSinceLast: decision.suppressedSinceLast,
    });
    this.recordMetric(alert, "delivered");
    return { delivered: true, suppressed: false };
  }

  private recordMetric(
    alert: RaiseAlertRequest,
    outcome: "delivered" | "suppressed" | "failed",
  ): void {
    try {
      void this.metricService
        .record({
          metricName: OBSERVATORY_ALERT_RAISED_METRIC,
          value: 1,
          tags: {
            source: alert.source,
            event: alert.event,
            severity: alert.severity,
            outcome,
          },
        })
        .catch(() => undefined);
    } catch {
      // 同步抛错（坏 client）也不许影响告警主路径。
    }
  }
}
