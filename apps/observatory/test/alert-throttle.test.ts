import { describe, expect, it } from "vitest";
import { AlertThrottle } from "../src/application/alert-throttle.js";

/**
 * 去重限流的窗口语义（issue #602）。时间基准全部走注入的 fake now——不碰真时钟。
 */
describe("AlertThrottle", () => {
  function makeThrottle(windowMs = 300_000) {
    let nowMs = 1_000_000;
    const throttle = new AlertThrottle({ now: () => new Date(nowMs), windowMs });
    return {
      throttle,
      advance: (ms: number) => {
        nowMs += ms;
      },
    };
  }

  const key = { source: "agent", event: "react.empty_stall" };

  it("窗口内首条放行并开窗，后续同键一律压制", () => {
    const { throttle } = makeThrottle();

    expect(throttle.admit(key)).toEqual({ admit: true, suppressedSinceLast: 0 });
    expect(throttle.admit(key)).toEqual({ admit: false });
    expect(throttle.admit(key)).toEqual({ admit: false });
  });

  it("不同 (source, event) 各自独立开窗，互不压制", () => {
    const { throttle } = makeThrottle();

    expect(throttle.admit(key).admit).toBe(true);
    expect(throttle.admit({ source: "agent", event: "react.no_tool_stall" }).admit).toBe(true);
    expect(throttle.admit({ source: "napcat", event: "react.empty_stall" }).admit).toBe(true);
  });

  it("边界取 >=：恰好窗口长度即放行", () => {
    const { throttle, advance } = makeThrottle(300_000);

    expect(throttle.admit(key).admit).toBe(true);
    advance(299_999);
    expect(throttle.admit(key)).toEqual({ admit: false });
    advance(1);
    expect(throttle.admit(key).admit).toBe(true);
  });

  it("窗口过后的下一条带回上一窗口被压制的次数，随后归零", () => {
    const { throttle, advance } = makeThrottle(300_000);

    throttle.admit(key);
    for (let index = 0; index < 12; index += 1) {
      throttle.admit(key);
    }

    advance(300_000);
    expect(throttle.admit(key)).toEqual({ admit: true, suppressedSinceLast: 12 });

    advance(300_000);
    expect(throttle.admit(key)).toEqual({ admit: true, suppressedSinceLast: 0 });
  });

  it("窗口以「尝试」为界：调用方投递失败与否，throttle 都已开窗", () => {
    const { throttle } = makeThrottle();

    // admit 只表达「放你去投递」，投递结果不回灌 throttle——所以第二次仍被压制。
    expect(throttle.admit(key).admit).toBe(true);
    expect(throttle.admit(key).admit).toBe(false);
  });

  it("窗口结束满 1h 的键被清理（清理后重新放行且压制计数归零）", () => {
    const { throttle, advance } = makeThrottle(300_000);

    throttle.admit(key);
    throttle.admit(key);
    throttle.admit(key);

    // 窗口 300s + 保留 3600s，再多走 1ms 触发清理。
    advance(300_000 + 3_600_000 + 1);
    expect(throttle.admit(key)).toEqual({ admit: true, suppressedSinceLast: 0 });
  });
});
