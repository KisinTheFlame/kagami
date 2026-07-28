import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { observatoryApiContract } from "@kagami/observatory-api/contract";
import type { RaiseAlertRequest } from "@kagami/observatory-api/alert";
import { AppLogger } from "@kagami/kernel/logger/logger";

const logger = new AppLogger({ source: "observatory-client.alert" });

/**
 * 告警上报客户端：把告警经 HTTP 打到独立的 kagami-observatory 进程（issue #602）。
 *
 * 自 #608 起从 agent 的 ACL 搬到本包，任何服务都能用——此前只有 agent 能告警，纯粹因为 client
 * 埋在 `apps/agent/src/acl/` 里，是位置问题不是能力问题。
 *
 * 语义是 fire-and-forget，与 `HttpMetricClient` 同族：**永不 reject**。`createClient` 在不可达 /
 * 非 2xx / 坏响应时会抛，这里一律吞掉并记日志——调用点是 `void raise(...)`，reject 会变成
 * unhandledRejection 把调用方进程拉挂，那就成了「告警把被告警的东西杀了」。
 *
 * 告警本身不会因此丢失：调用方在调它之前应无条件写一条本地 error 日志（`reportStall` 就是
 * 这么做的）。observatory 回的 `{ delivered, suppressed }` 这里只用于记日志——上报方不该因
 * 「被去重压制」或「通道失败」改变自己的行为，更不该重试。
 *
 * 刻意不 `implements` 任何本包定义的端口：调用方各自持有自己的告警端口类型（agent 的
 * `AlertNotifier` 就是一个），结构化类型天然对得上。在这里再造一个同形状接口只会多一份要
 * 同步维护的定义。
 */
export class HttpObservatoryClient {
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
          event: "observatory.alert_not_delivered",
          alertEvent: alert.event,
          suppressed: result.suppressed,
        });
      }
    } catch (error) {
      logger.errorWithCause("Failed to raise alert to observatory", error, {
        event: "observatory.raise_failed",
        alertEvent: alert.event,
      });
    }
  }
}
