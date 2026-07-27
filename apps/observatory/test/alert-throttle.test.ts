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
    // 清理只在越过容量上限时发生，故把上限压到 1 让这一路径可测。
    let nowMs = 1_000_000;
    const throttle = new AlertThrottle({
      now: () => new Date(nowMs),
      windowMs: 300_000,
      maxTrackedKeys: 1,
    });

    throttle.admit(key);
    throttle.admit(key);
    throttle.admit(key);

    // 窗口 300s + 保留 3600s，再多走 1ms → 该键已过期；插入另一个键触发容量检查并清掉它。
    nowMs += 300_000 + 3_600_000 + 1;
    throttle.admit({ source: "other", event: "other" });
    expect(throttle.admit(key)).toEqual({ admit: true, suppressedSinceLast: 0 });
  });

  it("复合键用长度前缀，`::` 出现在字段里也不会撞键", () => {
    const { throttle } = makeThrottle();

    // 裸 `${source}::${event}` 拼接会让这两个键塌成 "a::b::c"，第二个被误压制。
    expect(throttle.admit({ source: "a::b", event: "c" }).admit).toBe(true);
    expect(throttle.admit({ source: "a", event: "b::c" }).admit).toBe(true);
  });

  it("高基数 event 不会无界增长：超过上限按最久未开窗淘汰，进程不被拖死", () => {
    const nowMs = 1_000_000;
    const throttle = new AlertThrottle({
      now: () => new Date(nowMs),
      windowMs: 300_000,
      maxTrackedKeys: 4,
    });

    // 坏调用方把唯一 ID 塞进 event：全部在同一窗口内，时间清理挡不住，只有容量上限挡得住。
    for (let index = 0; index < 100; index += 1) {
      expect(throttle.admit({ source: "agent", event: `stall.${index}` }).admit).toBe(true);
    }

    // 最早的键早已被淘汰 → 再上报当首条放行（压制计数丢失是有意代价）。
    expect(throttle.admit({ source: "agent", event: "stall.0" })).toEqual({
      admit: true,
      suppressedSinceLast: 0,
    });
    // 最近的几个键仍在窗口内 → 仍被压制，说明淘汰的是「最久未开窗」的那一端。
    expect(throttle.admit({ source: "agent", event: "stall.99" }).admit).toBe(false);
  });

  it("重复开窗会把键移到淘汰队尾（LRU 而非 FIFO）", () => {
    let nowMs = 1_000_000;
    const throttle = new AlertThrottle({
      now: () => new Date(nowMs),
      windowMs: 300_000,
      maxTrackedKeys: 2,
    });

    const a = { source: "agent", event: "a" };
    const b = { source: "agent", event: "b" };
    throttle.admit(a);
    throttle.admit(b);

    // a 重新开窗 → a 变成最近使用；此后插入第三个键应淘汰 b 而不是 a。
    nowMs += 300_000;
    throttle.admit(a);
    throttle.admit(a); // 被压制，累加计数
    throttle.admit({ source: "agent", event: "c" });

    // a 仍在追踪中：窗口内 → 被压制。
    expect(throttle.admit(a).admit).toBe(false);
  });
});
