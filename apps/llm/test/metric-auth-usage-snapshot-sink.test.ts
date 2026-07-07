import type { MetricClient, RecordMetricInput } from "@kagami/metric-client/client";
import { describe, expect, it } from "vitest";
import {
  MetricAuthUsageSnapshotSink,
  OAUTH_QUOTA_REFRESH_SUCCESS_METRIC,
  OAUTH_QUOTA_REMAINING_PERCENT_METRIC,
} from "../src/app/metric-auth-usage-snapshot-sink.js";

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

describe("MetricAuthUsageSnapshotSink", () => {
  it("maps a window snapshot to the remaining_percent metric with provider/window tags", () => {
    const { client, calls } = capturing();
    const sink = new MetricAuthUsageSnapshotSink({ metricClient: client });
    const capturedAt = new Date("2026-07-08T10:00:00.000Z");

    sink.record({
      provider: "claude-code",
      window: "five_hour",
      remainingPercent: 75,
      capturedAt,
    });

    expect(calls).toEqual([
      {
        metricName: OAUTH_QUOTA_REMAINING_PERCENT_METRIC,
        value: 75,
        tags: { provider: "claude-code", window: "five_hour" },
        occurredAt: capturedAt,
      },
    ]);
  });

  it("maps refresh outcome to the refresh_success metric (1 success / 0 failure)", () => {
    const { client, calls } = capturing();
    const sink = new MetricAuthUsageSnapshotSink({ metricClient: client });

    sink.recordRefreshOutcome({ provider: "openai-codex", success: true });
    sink.recordRefreshOutcome({ provider: "openai-codex", success: false });

    expect(
      calls.map(call => ({ name: call.metricName, value: call.value, tags: call.tags })),
    ).toEqual([
      { name: OAUTH_QUOTA_REFRESH_SUCCESS_METRIC, value: 1, tags: { provider: "openai-codex" } },
      { name: OAUTH_QUOTA_REFRESH_SUCCESS_METRIC, value: 0, tags: { provider: "openai-codex" } },
    ]);
  });
});
