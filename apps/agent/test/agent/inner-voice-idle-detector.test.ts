import { describe, expect, it } from "vitest";
import {
  evaluateIdleTrigger,
  getBeijingHour,
  INNER_VOICE_IDLE_POLICY,
  isWaitToolCall,
  type InnerVoiceIdleSignals,
} from "../../src/agent/capabilities/inner-voice/domain/idle-detector.js";
import { InnerVoiceIdleTracker } from "../../src/agent/capabilities/inner-voice/domain/idle-tracker.js";
import { collectInnerVoiceIdleSignals } from "../../src/agent/capabilities/inner-voice/domain/ledger-idle-signals.js";
import { sliceRecentBalancedMessages } from "../../src/agent/capabilities/inner-voice/domain/recent-context-slice.js";
import type { LlmMessage } from "@kagami/llm-client";

// 北京时间 = UTC+8：Beijing 14:00 → UTC 06:00（非静默窗、正常触发时段）。
const NOW = new Date("2026-07-02T06:00:00Z");

function minutesAgo(minutes: number, base: Date = NOW): Date {
  return new Date(base.getTime() - minutes * 60_000);
}

/** 30min 窗口内的 count 个 wait（5/10/15… 分钟前，均落在窗内）。 */
function waitsWithin(count: number, base: Date = NOW): Date[] {
  return Array.from({ length: count }, (_, i) => minutesAgo(5 + i * 5, base));
}

function signals(partial: Partial<InnerVoiceIdleSignals>): InnerVoiceIdleSignals {
  return { waitAt: [], attemptAt: [], ...partial };
}

describe("isWaitToolCall", () => {
  it("只认 wait", () => {
    expect(isWaitToolCall("wait")).toBe(true);
    expect(isWaitToolCall("invoke")).toBe(false);
    expect(isWaitToolCall("search_web")).toBe(false);
    expect(isWaitToolCall("switch")).toBe(false);
  });
});

describe("evaluateIdleTrigger", () => {
  it("30min 内 wait ≥3 且非静默、无近期尝试 → 触发", () => {
    expect(evaluateIdleTrigger({ now: NOW, signals: signals({ waitAt: waitsWithin(3) }) })).toBe(
      true,
    );
  });

  it("wait 不足 3 → 不触发", () => {
    expect(evaluateIdleTrigger({ now: NOW, signals: signals({ waitAt: waitsWithin(2) }) })).toBe(
      false,
    );
  });

  it("窗口外（>30min 前）的 wait 不计数", () => {
    const stale = [minutesAgo(35), minutesAgo(40), minutesAgo(45)];
    expect(evaluateIdleTrigger({ now: NOW, signals: signals({ waitAt: stale }) })).toBe(false);
  });

  it("距上次尝试不足 30min 不应期 → 不触发", () => {
    expect(
      evaluateIdleTrigger({
        now: NOW,
        signals: signals({ waitAt: waitsWithin(3), attemptAt: [minutesAgo(20)] }),
      }),
    ).toBe(false);
  });

  it("距上次尝试 ≥30min → 触发", () => {
    expect(
      evaluateIdleTrigger({
        now: NOW,
        signals: signals({ waitAt: waitsWithin(3), attemptAt: [minutesAgo(35)] }),
      }),
    ).toBe(true);
  });

  it("静默窗内（北京 01:00–09:00）不触发", () => {
    // Beijing 03:00 → UTC 前一天 19:00。
    const deepNight = new Date("2026-07-01T19:00:00Z");
    expect(
      evaluateIdleTrigger({
        now: deepNight,
        signals: signals({ waitAt: waitsWithin(3, deepNight) }),
      }),
    ).toBe(false);
    // Beijing 01:00 边界（含）→ UTC 前一天 17:00。
    const oneAm = new Date("2026-07-01T17:00:00Z");
    expect(
      evaluateIdleTrigger({ now: oneAm, signals: signals({ waitAt: waitsWithin(3, oneAm) }) }),
    ).toBe(false);
  });

  it("静默窗边界外允许触发：北京 09:00（不含）与 00:30", () => {
    // Beijing 09:00 → UTC 01:00：hour=9 不在 [1,9)，允许。
    const nineAm = new Date("2026-07-02T01:00:00Z");
    expect(
      evaluateIdleTrigger({ now: nineAm, signals: signals({ waitAt: waitsWithin(3, nineAm) }) }),
    ).toBe(true);
    // Beijing 00:30 → UTC 前一天 16:30：hour=0 不在 [1,9)，允许。
    const halfPastMidnight = new Date("2026-07-01T16:30:00Z");
    expect(
      evaluateIdleTrigger({
        now: halfPastMidnight,
        signals: signals({ waitAt: waitsWithin(3, halfPastMidnight) }),
      }),
    ).toBe(true);
  });

  it("政策常量与 2026-07-04 定稿一致", () => {
    expect(INNER_VOICE_IDLE_POLICY.windowMs).toBe(30 * 60 * 1000);
    expect(INNER_VOICE_IDLE_POLICY.minWaitCount).toBe(3);
    expect(INNER_VOICE_IDLE_POLICY.attemptCooldownMs).toBe(30 * 60 * 1000);
    expect(INNER_VOICE_IDLE_POLICY.quietStartHour).toBe(1);
    expect(INNER_VOICE_IDLE_POLICY.quietEndHour).toBe(9);
  });
});

describe("getBeijingHour", () => {
  it("按北京时区给出小时（0–23）", () => {
    // UTC 7/1 17:00 = Beijing 7/2 01:00。
    expect(getBeijingHour(new Date("2026-07-01T17:00:00Z"))).toBe(1);
    // Beijing 0 点不被 Intl 的 "24" 污染。
    expect(getBeijingHour(new Date("2026-07-01T16:00:00Z"))).toBe(0);
  });
});

describe("InnerVoiceIdleTracker", () => {
  it("记录 3 个 wait → 判定 → 尝试后进入不应期", () => {
    const tracker = new InnerVoiceIdleTracker();
    for (const at of waitsWithin(3)) {
      tracker.recordWait(at);
    }
    expect(tracker.shouldTrigger(NOW)).toBe(true);
    tracker.recordAttempt(NOW);
    expect(tracker.shouldTrigger(new Date(NOW.getTime() + 60_000))).toBe(false);
  });

  it("restore 覆盖既有状态", () => {
    const tracker = new InnerVoiceIdleTracker();
    tracker.recordAttempt(minutesAgo(10));
    tracker.restore({ waitAt: waitsWithin(3), attemptAt: [] });
    expect(tracker.shouldTrigger(NOW)).toBe(true);
  });
});

describe("collectInnerVoiceIdleSignals", () => {
  it("从 ledger 记录重建 wait 与 attempt 两组时间戳", () => {
    const at = (i: number): Date => minutesAgo(30 - i);
    const records = [
      {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "t1", name: "wait", arguments: {} }],
        } as LlmMessage,
        createdAt: at(1),
      },
      {
        message: {
          role: "assistant",
          content: "",
          // 非 wait 调用不计入（不再区分「投入型」）。
          toolCalls: [{ id: "t2", name: "invoke", arguments: { tool: "glance_hn" } }],
        } as LlmMessage,
        createdAt: at(2),
      },
      {
        message: {
          role: "user",
          content: "<inner_thought>想翻翻那篇文章</inner_thought>",
        } as LlmMessage,
        createdAt: at(3),
      },
      {
        message: {
          role: "user",
          content: "<notification>QQ: 有新消息</notification>",
        } as LlmMessage,
        createdAt: at(4),
      },
    ];

    const result = collectInnerVoiceIdleSignals(records);
    expect(result.waitAt).toEqual([at(1)]);
    expect(result.attemptAt).toEqual([at(3)]);
  });
});

describe("sliceRecentBalancedMessages", () => {
  it("起点回退到 user 消息，保证 tool 配对完整", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "u1" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "t1", name: "invoke", arguments: {} }],
      },
      { role: "tool", toolCallId: "t1", content: "r1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "hi", toolCalls: [] },
    ];

    const sliced = sliceRecentBalancedMessages(messages, 2);
    expect(sliced[0]).toEqual({ role: "user", content: "u2" });
    expect(sliced).toHaveLength(2);
  });

  it("keepRecent 覆盖全量时原样返回", () => {
    const messages: LlmMessage[] = [{ role: "user", content: "u1" }];
    expect(sliceRecentBalancedMessages(messages, 40)).toEqual(messages);
  });
});
