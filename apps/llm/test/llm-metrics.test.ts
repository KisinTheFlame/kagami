import type { LlmChatCallObservation } from "@kagami/llm-client";
import type { MetricClient, RecordMetricInput } from "@kagami/metric-client/client";
import { describe, expect, it } from "vitest";
import { recordLlmCallMetrics } from "../src/app/llm-metrics.js";

function capturing(): { client: MetricClient; calls: RecordMetricInput[] } {
  const calls: RecordMetricInput[] = [];
  const client: MetricClient = {
    record: input => {
      calls.push(input);
      return Promise.resolve();
    },
  };
  return { client, calls };
}

function successObservation(
  over: Partial<Extract<LlmChatCallObservation, { status: "success" }>> = {},
): LlmChatCallObservation {
  return {
    status: "success",
    provider: "claude-code",
    model: "claude-x",
    usage: "agent",
    scene: "agent",
    extension: {},
    requestId: "r1",
    seq: 1,
    latencyMs: 1234,
    request: {},
    response: {
      usage: {
        promptTokens: 100,
        cacheHitTokens: 80,
        cacheMissTokens: 20,
        completionTokens: 50,
      },
    },
    nativeRequestPayload: null,
    nativeResponsePayload: null,
    ...over,
  };
}

function failedObservation(
  over: Partial<Extract<LlmChatCallObservation, { status: "failed" }>> = {},
): LlmChatCallObservation {
  return {
    status: "failed",
    provider: "openai",
    model: "gpt-x",
    usage: "agent",
    scene: "contextSummarizer",
    extension: null,
    requestId: "r2",
    seq: 1,
    latencyMs: 500,
    request: {},
    nativeRequestPayload: null,
    nativeResponsePayload: null,
    nativeError: null,
    error: new Error("boom"),
    ...over,
  };
}

describe("recordLlmCallMetrics", () => {
  it("emits call count, latency, and per-kind tokens on success", () => {
    const { client, calls } = capturing();
    recordLlmCallMetrics(client, successObservation());

    const byMetric = (name: string) => calls.filter(call => call.metricName === name);

    expect(byMetric("llm.call")).toEqual([
      {
        metricName: "llm.call",
        value: 1,
        tags: {
          provider: "claude-code",
          model: "claude-x",
          usage: "agent",
          scene: "agent",
          status: "success",
        },
      },
    ]);
    expect(byMetric("llm.call.latency")).toEqual([
      {
        metricName: "llm.call.latency",
        // 打点存原始毫秒；秒换算在前端。
        value: 1234,
        tags: {
          provider: "claude-code",
          model: "claude-x",
          usage: "agent",
          scene: "agent",
          status: "success",
        },
      },
    ]);

    const tokens = byMetric("llm.call.tokens");
    expect(tokens.map(call => ({ kind: call.tags?.kind, value: call.value }))).toEqual([
      { kind: "input_total", value: 100 },
      { kind: "input_cache_hit", value: 80 },
      { kind: "input_cache_miss", value: 20 },
      { kind: "output", value: 50 },
    ]);
    expect(tokens[0]?.tags).toMatchObject({ provider: "claude-code", usage: "agent" });
  });

  it("skips token kinds that are missing or zero", () => {
    const { client, calls } = capturing();
    recordLlmCallMetrics(
      client,
      successObservation({
        response: { usage: { promptTokens: 40, cacheHitTokens: 0, completionTokens: 40 } },
      }),
    );

    const kinds = calls.filter(c => c.metricName === "llm.call.tokens").map(c => c.tags?.kind);
    // cacheHitTokens=0 跳过、cacheMissTokens 缺失跳过；只留 input_total 与 output。
    expect(kinds).toEqual(["input_total", "output"]);
  });

  it("tags status=failed with an error class and emits no tokens", () => {
    const { client, calls } = capturing();
    recordLlmCallMetrics(client, failedObservation({ nativeError: { status: 429 } }));

    const call = calls.find(c => c.metricName === "llm.call");
    expect(call?.tags).toEqual({
      provider: "openai",
      model: "gpt-x",
      usage: "agent",
      scene: "contextSummarizer",
      status: "failed",
      error: "rate_limit",
    });
    expect(calls.some(c => c.metricName === "llm.call.latency")).toBe(true);
    expect(calls.some(c => c.metricName === "llm.call.tokens")).toBe(false);
  });

  it("classifies common failure kinds", () => {
    const kindOf = (over: Partial<Extract<LlmChatCallObservation, { status: "failed" }>>) => {
      const { client, calls } = capturing();
      recordLlmCallMetrics(client, failedObservation(over));
      return calls.find(c => c.metricName === "llm.call")?.tags?.error;
    };

    expect(kindOf({ nativeError: { status: 401 } })).toBe("auth");
    expect(kindOf({ nativeError: { status: 503 } })).toBe("server");
    expect(kindOf({ error: new Error("fetch failed") })).toBe("fetch_failed");
    expect(kindOf({ error: new Error("所选 LLM provider 当前不可用") })).toBe(
      "provider_unavailable",
    );
    expect(kindOf({ error: new Error("request timed out") })).toBe("timeout");
    expect(kindOf({ error: new Error("something odd") })).toBe("other");
    // 「不可用」子串但非 provider 哨兵串 → 不误标 provider_unavailable。
    expect(kindOf({ error: new Error("服务暂时不可用") })).toBe("other");
  });

  it("labels chatDirect (usage=null, scene=null) as 'direct' on both tags", () => {
    const { client, calls } = capturing();
    recordLlmCallMetrics(client, successObservation({ usage: null, scene: null }));
    expect(calls.every(c => c.tags?.usage === "direct")).toBe(true);
    expect(calls.every(c => c.tags?.scene === "direct")).toBe(true);
  });
});
