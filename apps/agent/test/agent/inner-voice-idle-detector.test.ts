import { describe, expect, it } from "vitest";
import {
  classifyRootToolCall,
  evaluateIdleTrigger,
  getBeijingClock,
  INNER_VOICE_IDLE_POLICY,
  type InnerVoiceIdleSignals,
} from "../../src/agent/capabilities/inner-voice/domain/idle-detector.js";
import { InnerVoiceIdleTracker } from "../../src/agent/capabilities/inner-voice/domain/idle-tracker.js";
import { collectInnerVoiceIdleSignals } from "../../src/agent/capabilities/inner-voice/domain/ledger-idle-signals.js";
import { sliceRecentBalancedMessages } from "../../src/agent/capabilities/inner-voice/domain/recent-context-slice.js";
import type { LlmMessage } from "@kagami/llm-client";

// 北京时间 = UTC+8：Beijing 14:00 → UTC 06:00。测试全部用 UTC 构造。
const NOW = new Date("2026-07-02T06:00:00Z");

function minutesAgo(minutes: number, base: Date = NOW): Date {
  return new Date(base.getTime() - minutes * 60_000);
}

function waitsWithin(count: number, base: Date = NOW): Date[] {
  return Array.from({ length: count }, (_, i) => minutesAgo(5 + i * 5, base));
}

function signals(partial: Partial<InnerVoiceIdleSignals>): InnerVoiceIdleSignals {
  return { waitAt: [], engagedAt: [], attemptAt: [], ...partial };
}

describe("classifyRootToolCall", () => {
  it("wait 归 wait", () => {
    expect(classifyRootToolCall({ name: "wait", argumentsValue: {} })).toBe("wait");
  });

  it("search_web 是顶层投入型", () => {
    expect(classifyRootToolCall({ name: "search_web", argumentsValue: {} })).toBe("engaged");
  });

  it("invoke 的投入型子工具按枚举判定", () => {
    expect(
      classifyRootToolCall({ name: "invoke", argumentsValue: { tool: "open_ithome_article" } }),
    ).toBe("engaged");
    expect(classifyRootToolCall({ name: "invoke", argumentsValue: { tool: "bash" } })).toBe(
      "engaged",
    );
    expect(classifyRootToolCall({ name: "invoke", argumentsValue: { tool: "add_todo" } })).toBe(
      "engaged",
    );
  });

  it("QQ 聊天动作不算投入型——刷群接话正是摸鱼本身", () => {
    expect(
      classifyRootToolCall({ name: "invoke", argumentsValue: { tool: "open_conversation" } }),
    ).toBe("neutral");
    expect(classifyRootToolCall({ name: "invoke", argumentsValue: { tool: "send_message" } })).toBe(
      "neutral",
    );
    expect(classifyRootToolCall({ name: "switch", argumentsValue: { id: "qq" } })).toBe("neutral");
  });
});

describe("evaluateIdleTrigger", () => {
  it("窗口内 wait 达标且其余条件满足 → 触发", () => {
    expect(evaluateIdleTrigger({ now: NOW, signals: signals({ waitAt: waitsWithin(6) }) })).toBe(
      true,
    );
  });

  it("wait 不足 minWaitCount → 不触发", () => {
    expect(evaluateIdleTrigger({ now: NOW, signals: signals({ waitAt: waitsWithin(5) }) })).toBe(
      false,
    );
  });

  it("窗口外的 wait 不计数", () => {
    const stale = Array.from({ length: 6 }, (_, i) => minutesAgo(70 + i * 5));
    expect(evaluateIdleTrigger({ now: NOW, signals: signals({ waitAt: stale }) })).toBe(false);
  });

  it("窗口内有投入型调用 → 豁免不触发", () => {
    expect(
      evaluateIdleTrigger({
        now: NOW,
        signals: signals({ waitAt: waitsWithin(8), engagedAt: [minutesAgo(30)] }),
      }),
    ).toBe(false);
  });

  it("窗口外的投入型调用不豁免", () => {
    expect(
      evaluateIdleTrigger({
        now: NOW,
        signals: signals({ waitAt: waitsWithin(6), engagedAt: [minutesAgo(90)] }),
      }),
    ).toBe(true);
  });

  it("当日注入尝试达上限（3 次）→ 不触发", () => {
    expect(
      evaluateIdleTrigger({
        now: NOW,
        signals: signals({
          waitAt: waitsWithin(6),
          // 同为北京 7/2 的三次尝试（Beijing 09:00 / 09:30 / 10:00）；最后一次距 NOW 恰
          // 满 4h 不应期（不再被 cooldown 拦），故此处只由日上限判定拦下。
          attemptAt: [
            new Date("2026-07-02T01:00:00Z"),
            new Date("2026-07-02T01:30:00Z"),
            new Date("2026-07-02T02:00:00Z"),
          ],
        }),
      }),
    ).toBe(false);
  });

  it("昨天的尝试不占今天的配额，但仍受不应期约束", () => {
    // 昨天 Beijing 23:00（UTC 15:00）：距 NOW 15 小时，超过 4h 不应期。
    expect(
      evaluateIdleTrigger({
        now: NOW,
        signals: signals({
          waitAt: waitsWithin(6),
          attemptAt: [new Date("2026-07-01T15:00:00Z")],
        }),
      }),
    ).toBe(true);
  });

  it("距上次尝试不足不应期 → 不触发", () => {
    expect(
      evaluateIdleTrigger({
        now: NOW,
        signals: signals({ waitAt: waitsWithin(6), attemptAt: [minutesAgo(120)] }),
      }),
    ).toBe(false);
  });

  it("时段窗外（北京深夜）不触发", () => {
    // Beijing 23:30 → UTC 15:30。
    const lateNight = new Date("2026-07-02T15:30:00Z");
    expect(
      evaluateIdleTrigger({
        now: lateNight,
        signals: signals({ waitAt: waitsWithin(6, lateNight) }),
      }),
    ).toBe(false);
    // Beijing 09:59 → UTC 01:59。
    const earlyMorning = new Date("2026-07-02T01:59:00Z");
    expect(
      evaluateIdleTrigger({
        now: earlyMorning,
        signals: signals({ waitAt: waitsWithin(6, earlyMorning) }),
      }),
    ).toBe(false);
  });

  it("政策常量与 issue #265 定稿一致", () => {
    expect(INNER_VOICE_IDLE_POLICY.dailyAttemptLimit).toBe(3);
    expect(INNER_VOICE_IDLE_POLICY.attemptCooldownMs).toBe(4 * 60 * 60 * 1000);
    expect(INNER_VOICE_IDLE_POLICY.activeStartHour).toBe(10);
    expect(INNER_VOICE_IDLE_POLICY.activeEndHour).toBe(23);
  });
});

describe("getBeijingClock", () => {
  it("按北京时区给出自然日与小时", () => {
    // UTC 7/1 17:00 = Beijing 7/2 01:00 —— 跨日。
    expect(getBeijingClock(new Date("2026-07-01T17:00:00Z"))).toEqual({
      dayKey: "2026-07-02",
      hour: 1,
    });
    // Beijing 0 点不被 Intl 的 "24" 污染。
    expect(getBeijingClock(new Date("2026-07-01T16:00:00Z")).hour).toBe(0);
  });
});

describe("InnerVoiceIdleTracker", () => {
  it("记录→判定→尝试后进入不应期", () => {
    const tracker = new InnerVoiceIdleTracker();
    for (const at of waitsWithin(6)) {
      tracker.recordToolCall("wait", at);
    }
    expect(tracker.shouldTrigger(NOW)).toBe(true);
    tracker.recordAttempt(NOW);
    expect(tracker.shouldTrigger(new Date(NOW.getTime() + 60_000))).toBe(false);
  });

  it("投入型调用会豁免触发（行为回填熄火）", () => {
    const tracker = new InnerVoiceIdleTracker();
    for (const at of waitsWithin(6)) {
      tracker.recordToolCall("wait", at);
    }
    tracker.recordToolCall("engaged", minutesAgo(2));
    expect(tracker.shouldTrigger(NOW)).toBe(false);
  });

  it("restore 覆盖既有状态", () => {
    const tracker = new InnerVoiceIdleTracker();
    tracker.recordAttempt(minutesAgo(10));
    tracker.restore({ waitAt: waitsWithin(6), engagedAt: [], attemptAt: [] });
    expect(tracker.shouldTrigger(NOW)).toBe(true);
  });
});

describe("collectInnerVoiceIdleSignals", () => {
  it("从 ledger 记录重建三组时间戳", () => {
    const at = (i: number): Date => minutesAgo(60 - i);
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
    expect(result.engagedAt).toEqual([at(2)]);
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

    // keepRecent=2 会落在 assistant 上，应回退到 u2。
    const sliced = sliceRecentBalancedMessages(messages, 2);
    expect(sliced[0]).toEqual({ role: "user", content: "u2" });
    expect(sliced).toHaveLength(2);
  });

  it("keepRecent 覆盖全量时原样返回", () => {
    const messages: LlmMessage[] = [{ role: "user", content: "u1" }];
    expect(sliceRecentBalancedMessages(messages, 40)).toEqual(messages);
  });
});
