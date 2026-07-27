import { describe, expect, it } from "vitest";
import {
  StallGuard,
  classifyRoundShape,
  createStallAlert,
} from "../../src/agent/runtime/root-agent/stall-guard.js";

describe("classifyRoundShape", () => {
  it("有 tool call → acted（含只调 control 工具的轮次：切 App 是动作，不是卡住）", () => {
    expect(classifyRoundShape({ content: "", toolCalls: [{}] })).toBe("acted");
    expect(classifyRoundShape({ content: "说点什么", toolCalls: [{}, {}] })).toBe("acted");
  });

  it("零 tool call + 有文本 → text_only", () => {
    expect(classifyRoundShape({ content: "这轮不动。", toolCalls: [] })).toBe("text_only");
  });

  it("零 tool call + 空文本 → empty", () => {
    expect(classifyRoundShape({ content: "", toolCalls: [] })).toBe("empty");
  });

  it("纯空白文本判 empty——与持久化门控同判（那里也是 trim().length > 0）", () => {
    expect(classifyRoundShape({ content: "   \n\t ", toolCalls: [] })).toBe("empty");
  });
});

/**
 * 两个计数器一层包一层（empty ⊂ noTool），共用阈值 4。issue #602。
 */
describe("StallGuard", () => {
  function observeAll(guard: StallGuard, shapes: Parameters<StallGuard["observe"]>[0][]) {
    return shapes.map(shape => guard.observe(shape));
  }

  it("acted 不挂起、不告警", () => {
    const guard = new StallGuard();
    for (let index = 0; index < 10; index += 1) {
      expect(guard.observe("acted")).toEqual({ suspend: false, alert: null });
    }
  });

  it("4 连纯文本轮：前 3 轮放行，第 4 轮挂起并报 no_tool", () => {
    const guard = new StallGuard();
    const results = observeAll(guard, ["text_only", "text_only", "text_only", "text_only"]);

    expect(results.slice(0, 3)).toEqual([
      { suspend: false, alert: null },
      { suspend: false, alert: null },
      { suspend: false, alert: null },
    ]);
    expect(results[3]).toEqual({
      suspend: true,
      alert: { reason: "no_tool", emptyStreak: 0, noToolStreak: 4 },
    });
  });

  it("4 连空轮：两个计数器同轮到顶，取更具体的 empty", () => {
    const guard = new StallGuard();
    const results = observeAll(guard, ["empty", "empty", "empty", "empty"]);

    expect(results[3]).toEqual({
      suspend: true,
      alert: { reason: "empty", emptyStreak: 4, noToolStreak: 4 },
    });
  });

  it("text_only 清空 emptyStreak 但不清 noToolStreak（一层包一层）", () => {
    const guard = new StallGuard();
    const results = observeAll(guard, ["empty", "empty", "text_only", "empty"]);

    // 第 4 轮：noTool 到 4，empty 只有 1（第 3 轮的 text_only 把它清了）→ 报 no_tool。
    expect(results[3]).toEqual({
      suspend: true,
      alert: { reason: "no_tool", emptyStreak: 1, noToolStreak: 4 },
    });
  });

  it("混合链 text,empty,empty,empty：报 no_tool，载荷带两个计数供分辨形态", () => {
    const guard = new StallGuard();
    const results = observeAll(guard, ["text_only", "empty", "empty", "empty"]);

    expect(results[3]).toEqual({
      suspend: true,
      alert: { reason: "no_tool", emptyStreak: 3, noToolStreak: 4 },
    });
  });

  it("acted 把两个计数器一起归零", () => {
    const guard = new StallGuard();
    observeAll(guard, ["empty", "empty", "empty"]);
    expect(guard.observe("acted")).toEqual({ suspend: false, alert: null });

    // 归零后要重新攒满 4 轮才触发。
    const results = observeAll(guard, ["empty", "empty", "empty"]);
    expect(results.every(result => result.suspend === false)).toBe(true);
    expect(guard.observe("empty").suspend).toBe(true);
  });

  it("触发后自动归零：紧接着的下一个无动作轮不会立刻再触发", () => {
    const guard = new StallGuard();
    observeAll(guard, ["empty", "empty", "empty", "empty"]);

    expect(guard.observe("empty")).toEqual({ suspend: false, alert: null });
    expect(guard.observe("empty")).toEqual({ suspend: false, alert: null });
    expect(guard.observe("empty")).toEqual({ suspend: false, alert: null });
    expect(guard.observe("empty").suspend).toBe(true);
  });

  it("reset() 重开活性窗口（resetContext 用）", () => {
    const guard = new StallGuard();
    observeAll(guard, ["empty", "empty", "empty"]);
    guard.reset();

    expect(guard.observe("empty")).toEqual({ suspend: false, alert: null });
  });

  it("阈值可注入：threshold=1 时第一个无动作轮即触发", () => {
    const guard = new StallGuard({ threshold: 1 });
    expect(guard.observe("text_only")).toEqual({
      suspend: true,
      alert: { reason: "no_tool", emptyStreak: 0, noToolStreak: 1 },
    });
  });
});

describe("createStallAlert", () => {
  it("empty → react.empty_stall，标题用 emptyStreak", () => {
    expect(
      createStallAlert({ reason: "empty", emptyStreak: 4, noToolStreak: 4, runtimeKey: "root" }),
    ).toEqual({
      source: "agent",
      event: "react.empty_stall",
      severity: "error",
      title: "连续 4 轮 LLM 返回空内容，已挂起等待下一个事件。",
      context: { emptyStreak: 4, noToolStreak: 4, runtimeKey: "root" },
    });
  });

  it("no_tool → react.no_tool_stall，标题用 noToolStreak", () => {
    expect(
      createStallAlert({ reason: "no_tool", emptyStreak: 3, noToolStreak: 4, runtimeKey: "root" }),
    ).toEqual({
      source: "agent",
      event: "react.no_tool_stall",
      severity: "error",
      title: "连续 4 轮没有任何工具调用，已挂起等待下一个事件。",
      context: { emptyStreak: 3, noToolStreak: 4, runtimeKey: "root" },
    });
  });

  it("不带 detail 字段（stall 的全部信息都在 title + context 里）", () => {
    const alert = createStallAlert({
      reason: "empty",
      emptyStreak: 4,
      noToolStreak: 4,
      runtimeKey: "root",
    });
    expect("detail" in alert).toBe(false);
  });
});
