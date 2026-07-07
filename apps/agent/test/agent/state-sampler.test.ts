import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StateSampler,
  STATE_SAMPLE_METRIC_NAME,
} from "../../src/agent/runtime/root-agent/state-sampler.js";
import type { RecordMetricInput } from "@kagami/metric-client/client";

describe("StateSampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(getStateTag: () => string) {
    const records: RecordMetricInput[] = [];
    const metricClient = {
      record: vi.fn(async (input: RecordMetricInput) => {
        records.push(input);
      }),
    };
    const sampler = new StateSampler({
      getStateTag,
      metricClient,
      now: () => new Date("2026-07-07T00:00:00.000Z"),
      intervalMs: 2000,
    });
    return { sampler, records, metricClient };
  }

  it("每 intervalMs 打一条 value=1 的 agent.state.sample，tags.state 取当前状态，occurredAt 为 Date", () => {
    let state = "qq";
    const { sampler, records } = setup(() => state);
    sampler.start();

    vi.advanceTimersByTime(2000);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      metricName: STATE_SAMPLE_METRIC_NAME,
      value: 1,
      tags: { state: "qq" },
    });
    expect(records[0]?.occurredAt).toBeInstanceOf(Date);

    // 状态变化后下一 tick 采到新状态。
    state = "wait";
    vi.advanceTimersByTime(2000);
    expect(records).toHaveLength(2);
    expect(records[1]?.tags).toEqual({ state: "wait" });

    sampler.stop();
  });

  it("stop 后不再打点", () => {
    const { sampler, records } = setup(() => "portal");
    sampler.start();
    vi.advanceTimersByTime(2000);
    expect(records).toHaveLength(1);

    sampler.stop();
    vi.advanceTimersByTime(10000);
    expect(records).toHaveLength(1);
  });

  it("重复 start 幂等：只保留一个定时器，一个 tick 只打一条", () => {
    const { sampler, records } = setup(() => "browser");
    sampler.start();
    sampler.start();
    vi.advanceTimersByTime(2000);
    expect(records).toHaveLength(1);
    sampler.stop();
  });

  it("record 抛错不冒泡（fire-and-forget）", () => {
    const { sampler } = setup(() => "qq");
    // 覆盖成抛错的 record，验证 sampleOnce 不让它冒泡崩溃定时器回调。
    const throwingClient = new StateSampler({
      getStateTag: () => "qq",
      metricClient: {
        record: vi.fn(() => Promise.reject(new Error("metric down"))),
      },
      now: () => new Date("2026-07-07T00:00:00.000Z"),
      intervalMs: 2000,
    });
    throwingClient.start();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    throwingClient.stop();
    sampler.stop();
  });
});
