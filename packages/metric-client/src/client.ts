import { BizError } from "@kagami/kernel/errors/biz-error";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { createClient, type JsonClient } from "@kagami/rpc-client/client";
import { metricApiContract } from "@kagami/metric-api/contract";

/** 打点标签：平凡的字符串 map。 */
export type MetricTags = Record<string, string>;

/** 一条打点的 ergonomic 输入（occurredAt 是 Date；SDK 内部转成 wire 的 ISO string）。 */
export type RecordMetricInput = {
  metricName: string;
  value: number;
  tags?: MetricTags;
  occurredAt?: Date;
};

/**
 * metric 上报客户端接口。record 语义是 fire-and-forget：对一切失败记日志后咽下、**永不 reject**
 * （调用点有 `void record()`，reject → unhandledRejection → 拉挂 agent 进程）。
 */
export interface MetricClient {
  record(input: RecordMetricInput): Promise<void>;
}

/** 打点用的 null-object：接口成立、什么都不做。测试 / 未配置 metric 时用。 */
export const NOOP_METRIC_CLIENT: MetricClient = {
  async record(): Promise<void> {
    // no-op
  },
};

type FetchLike = typeof fetch;

const logger = new AppLogger({ source: "metric.service" });

/**
 * 独立 metric 服务（`@kagami/metric`）的 fire-and-forget 上报 SDK。
 *
 * 传输层复用 @kagami/metric-api 契约驱动的 `createClient`（与 llm/browser/spire 一族一致，不再
 * 手写 fetch）。fire-and-forget 语义 = 在 `createClient` 之上包一层「吞掉它一切 throw」的 try/catch：
 * createClient 会读+parse 响应体、非 2xx / 坏响应即 throw，本 SDK 把这些收敛成「记日志后咽下、
 * 永不 reject」。
 *
 * 与旧手写 sender 相比**有意接受**的行为变化（issue #328）：createClient 会读失败 body（旧的立刻
 * `cancel()`；2s 超时兜底）、2xx 非 `{ ok: true }` 会记 `http_error`（旧的静默成功）。日志分级
 * （event / level / status / source）显式复刻，监控基线不破。
 */
export class HttpMetricClient implements MetricClient {
  private readonly api: JsonClient<typeof metricApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: { baseUrl: string; fetch?: FetchLike }) {
    this.api = createClient(metricApiContract, {
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      // 2s：metric 黑洞化（接受 TCP 但不响应）时兜底，不让 pending promise / socket 随打点频率堆积。
      timeoutMs: 2000,
      // 所有非 2xx 一律归 bad_status：否则默认 decodeBizErrorWire 会截获 { error: BizErrorWire } 富
      // 信封、打乱分类，破坏「非 2xx 一律 warn + status」的日志基线。
      decodeError: () => undefined,
    });
  }

  public async record(input: RecordMetricInput): Promise<void> {
    try {
      // Date→ISO 放 try 内：occurredAt 若是 Invalid Date，toISOString() 抛 RangeError，一并吞。
      await this.api.record({
        metricName: input.metricName,
        value: input.value,
        tags: input.tags,
        occurredAt: input.occurredAt?.toISOString(),
      });
    } catch (error) {
      // 按错误类型复刻旧日志分级：
      // - 非 2xx → BizError(reason="bad_status", status) → warn + http_failed + status
      // - 其它（网络/超时的 unreachable、坏响应体 invalid_response_body、坏 output 的**裸 ZodError**、
      //   Invalid Date 的 RangeError）→ errorWithCause + http_error
      if (error instanceof BizError && error.meta?.reason === "bad_status") {
        logger.warn("Metric record endpoint returned non-2xx", {
          event: "metric.record.http_failed",
          status: error.meta.status,
          metricName: input.metricName,
        });
      } else {
        logger.errorWithCause("Failed to report metric over HTTP", error, {
          event: "metric.record.http_error",
          metricName: input.metricName,
        });
      }
    }
  }
}
