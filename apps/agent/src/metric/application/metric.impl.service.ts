import { AppLogger } from "@kagami/kernel/logger/logger";
import { metricApiContract } from "@kagami/metric-api/contract";
import type { RecordMetricRequest } from "@kagami/metric-api/record";
import type { MetricService, RecordMetricInput } from "./metric.service.js";

type FetchLike = typeof fetch;

type HttpMetricServiceDeps = {
  baseUrl: string;
  fetch?: FetchLike;
};

const logger = new AppLogger({ source: "metric.service" });

/**
 * 独立 metric 服务（`@kagami/metric`）的最小 HTTP 上报客户端：把一条打点 POST 进
 * `/metric/record`。语义是 fire-and-forget——校验权威在服务端，client 只序列化 + 发送，
 * 对一切失败（网络异常 / 非 2xx / 400）记日志后咽下、**绝不抛**，绝不阻塞 Agent 主流程。
 *
 * 刻意不走 createClient：它会读并 parse 响应体、把非 2xx 变成 throw，与这里「不读响应体、
 * 分级记日志、永不抛」的语义相悖。路由与请求类型仍以 @kagami/metric-api 为单一事实源
 * （path 从契约取、body 按契约 input 类型标注，#279 PR3）。
 */
export class HttpMetricService implements MetricService {
  private readonly recordUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor({ baseUrl, fetch: fetchImpl }: HttpMetricServiceDeps) {
    this.recordUrl = `${baseUrl.replace(/\/+$/, "")}${metricApiContract.record.path}`;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async record(input: RecordMetricInput): Promise<void> {
    try {
      // body 构造放进 try：occurredAt 若是 Invalid Date，`toISOString()` 会抛 RangeError，
      // 必须一并被咽下——否则 async record() 返回 rejected promise，而调用方全是 void
      // fire-and-forget，会变成 unhandledRejection 拉挂 agent 进程。
      const body: RecordMetricRequest = {
        metricName: input.metricName,
        value: input.value,
        tags: input.tags,
        occurredAt: input.occurredAt?.toISOString(),
      };

      const response = await this.fetchImpl(this.recordUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // metric 进程黑洞化（接受 TCP 但不响应）时，无 timeout 会让 pending promise / socket
        // 随 tool-call 频率堆积；2s 超时后归入下面的 catch。
        signal: AbortSignal.timeout(2000),
      });

      if (!response.ok) {
        logger.warn("Metric record endpoint returned non-2xx", {
          event: "metric.record.http_failed",
          status: response.status,
          metricName: input.metricName,
        });
      }
    } catch (error) {
      logger.errorWithCause("Failed to report metric over HTTP", error, {
        event: "metric.record.http_error",
        metricName: input.metricName,
      });
    }
  }
}
