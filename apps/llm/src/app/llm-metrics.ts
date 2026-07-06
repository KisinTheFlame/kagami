import {
  LLM_PROVIDER_UNAVAILABLE_MESSAGE,
  type LlmChatCallErrorObservation,
  type LlmChatCallObservation,
} from "@kagami/llm-client";
import type { MetricClient } from "@kagami/metric-client/client";

// LLM 调用打点（fire-and-forget）：在 kagami-llm 的观测点把每次 attempt 记成 metric，喂给独占 DuckDB
// 的查询/派生层（P1-P4）。三个 metric：
// - llm.call        计数（provider/model/status/usage[来处]，失败带 error 粗分类）→ 调用量 / 成功率
// - llm.call.latency 延迟秒（同上 tags）→ p50/p95/p99
// - llm.call.tokens  token 用量，按 kind 拆（input_total/input_cache_hit/input_cache_miss/output）
//                    → 用量 + KV 缓存命中率（cache_hit ÷ input_total，派生一条比率线）
// record 永不 reject（HttpMetricClient 咽下失败），故一律 `void`，绝不影响 LLM 结果。

const METRIC_CALL = "llm.call";
const METRIC_LATENCY = "llm.call.latency";
const METRIC_TOKENS = "llm.call.tokens";

/** 毫秒 → 秒。latency 以秒为单位打点（前端直接显示秒，单位口径在后端定死）。 */
const MS_PER_SECOND = 1000;

/** response.usage 的 token 字段 → 打点 kind。input_total = 命中 + 未命中（见 claude-code-response）。 */
const TOKEN_KINDS: ReadonlyArray<readonly [kind: string, field: string]> = [
  ["input_total", "promptTokens"],
  ["input_cache_hit", "cacheHitTokens"],
  ["input_cache_miss", "cacheMissTokens"],
  ["output", "completionTokens"],
];

export function recordLlmCallMetrics(
  metricService: MetricClient,
  observation: LlmChatCallObservation,
): void {
  const base = {
    provider: observation.provider,
    model: observation.model,
    // chatDirect 无调用来处 → "direct"。
    usage: observation.usage ?? "direct",
  };

  void metricService.record({
    metricName: METRIC_CALL,
    value: 1,
    tags: {
      ...base,
      status: observation.status,
      ...(observation.status === "failed" ? { error: classifyLlmError(observation) } : {}),
    },
  });

  void metricService.record({
    metricName: METRIC_LATENCY,
    // 以秒打点：LLM 调用动辄数秒，秒比毫秒更好读；p50/p95/p99 也直接是秒。
    value: observation.latencyMs / MS_PER_SECOND,
    tags: { ...base, status: observation.status },
  });

  if (observation.status === "success") {
    for (const [kind, value] of extractUsageTokens(observation.response)) {
      void metricService.record({
        metricName: METRIC_TOKENS,
        value,
        tags: { ...base, kind },
      });
    }
  }
}

/** 从 recordable response 里安全取 4 类 token（缺失 / 非有限 / ≤0 一律跳过，不打 0 点省行数）。 */
function extractUsageTokens(response: Record<string, unknown>): Array<[string, number]> {
  const usage = response.usage;
  if (typeof usage !== "object" || usage === null) {
    return [];
  }
  const fields = usage as Record<string, unknown>;
  const result: Array<[string, number]> = [];
  for (const [kind, field] of TOKEN_KINDS) {
    const value = fields[field];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      result.push([kind, value]);
    }
  }
  return result;
}

/** 失败原因粗分类（一个 tag 维度，别做成大而全的错误树）：先看 HTTP status，再看消息关键字。 */
function classifyLlmError(observation: LlmChatCallErrorObservation): string {
  const status = readNumber(observation.nativeError, "status");
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 408) {
    return "timeout";
  }
  if (typeof status === "number" && status >= 500) {
    return "server";
  }

  const message = extractErrorMessage(observation).toLowerCase();
  // provider 不可用错误消息是中文哨兵串（LLM_PROVIDER_UNAVAILABLE_MESSAGE）。匹配完整哨兵而非「不可用」
  // 子串，避免把「服务暂时不可用」等普通消息误标成 provider_unavailable。
  if (
    message.includes("unavailable") ||
    message.includes(LLM_PROVIDER_UNAVAILABLE_MESSAGE.toLowerCase())
  ) {
    return "provider_unavailable";
  }
  if (message.includes("fetch failed")) {
    return "fetch_failed";
  }
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("etimedout") ||
    message.includes("aborted")
  ) {
    return "timeout";
  }
  return "other";
}

function extractErrorMessage(observation: LlmChatCallErrorObservation): string {
  const parts: string[] = [];
  const error = observation.error;
  if (typeof error === "string") {
    parts.push(error);
  } else if (error instanceof Error) {
    parts.push(error.message);
  } else {
    const message = readString(error, "message");
    if (message !== undefined) {
      parts.push(message);
    }
  }
  const nativeMessage = readString(observation.nativeError, "message");
  if (nativeMessage !== undefined) {
    parts.push(nativeMessage);
  }
  return parts.join(" ");
}

function readNumber(source: unknown, key: string): number | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
