import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { observatoryApiContract } from "@kagami/observatory-api/contract";
import type { RaiseAlertRequest } from "@kagami/observatory-api/alert";
import { AppLogger } from "@kagami/kernel/logger/logger";
import type { AlertNotifier } from "../agent/runtime/root-agent/alert-notifier.js";

const logger = new AppLogger({ source: "agent.observatory-client" });

/**
 * 告警上报客户端：把告警经 HTTP 打到独立的 kagami-observatory 进程（issue #602）。
 *
 * 语义是 fire-and-forget，与 `HttpMetricClient` 同族：**永不 reject**。`createClient` 在不可达 /
 * 非 2xx / 坏响应时会抛，这里一律吞掉并记日志——调用点是 `void raise(...)`，reject 会变成
 * unhandledRejection 把 agent 进程拉挂，那就成了「告警把被告警的东西杀了」。
 *
 * 告警本身不会因此丢失：调用方（`reportStall`）在调它之前已无条件写了一条本地 error 日志。
 * observatory 回的 `{ delivered, suppressed }` 这里只用于记日志——上报方不该因「被去重压制」
 * 或「通道失败」改变自己的行为，更不该重试。
 */
export class HttpObservatoryClient implements AlertNotifier {
  private readonly api: JsonClient<typeof observatoryApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: typeof fetch }) {
    this.api = createClient(observatoryApiContract, {
      baseUrl,
      unreachableMessage: "kagami-observatory 不可达，告警未推送",
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  public async raise(alert: RaiseAlertRequest): Promise<void> {
    try {
      const result = await this.api.raiseAlert(alert);
      if (!result.delivered) {
        logger.warn("Alert accepted by observatory but not delivered", {
          event: "agent.observatory.alert_not_delivered",
          alertEvent: alert.event,
          suppressed: result.suppressed,
        });
      }
    } catch (error) {
      logger.errorWithCause("Failed to raise alert to observatory", error, {
        event: "agent.observatory.raise_failed",
        alertEvent: alert.event,
      });
    }
  }
}
