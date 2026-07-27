import { describe, expect, it } from "vitest";
import { renderAlertMessage } from "../src/domain/alert-message.js";

/** 固定时刻（东八区 2026-07-28 21:15:03）。 */
const OCCURRED_AT = new Date("2026-07-28T13:15:03.000Z");

describe("renderAlertMessage", () => {
  it("最小载荷：首行标头 + 标题 + 时间戳", () => {
    const message = renderAlertMessage({
      alert: { source: "agent", event: "react.empty_stall", severity: "error", title: "她哑了。" },
      occurredAt: OCCURRED_AT,
      suppressedSinceLast: 0,
    });

    expect(message).toBe(
      ["【error】agent · react.empty_stall", "她哑了。", "2026-07-28 21:15:03"].join("\n"),
    );
  });

  it("三档 severity 都出现在首行标头里", () => {
    for (const severity of ["warn", "error", "fatal"] as const) {
      const message = renderAlertMessage({
        alert: { source: "manual", event: "smoke", severity, title: "t" },
        occurredAt: OCCURRED_AT,
        suppressedSinceLast: 0,
      });
      expect(message.split("\n")[0]).toBe(`【${severity}】manual · smoke`);
    }
  });

  it("context 逐键渲染成 key: value 行", () => {
    const message = renderAlertMessage({
      alert: {
        source: "agent",
        event: "react.no_tool_stall",
        severity: "error",
        title: "没动手。",
        context: { emptyStreak: 3, noToolStreak: 4, runtimeKey: "root", degraded: true },
      },
      occurredAt: OCCURRED_AT,
      suppressedSinceLast: 0,
    });

    expect(message.split("\n")).toEqual([
      "【error】agent · react.no_tool_stall",
      "没动手。",
      "emptyStreak: 3",
      "noToolStreak: 4",
      "runtimeKey: root",
      "degraded: true",
      "2026-07-28 21:15:03",
    ]);
  });

  it("detail 出现在标题之后、context 之前；纯空白 detail 被忽略", () => {
    const withDetail = renderAlertMessage({
      alert: {
        source: "agent",
        event: "e",
        severity: "warn",
        title: "t",
        detail: "第一行\n第二行",
        context: { k: "v" },
      },
      occurredAt: OCCURRED_AT,
      suppressedSinceLast: 0,
    });
    expect(withDetail.split("\n")).toEqual([
      "【warn】agent · e",
      "t",
      "第一行",
      "第二行",
      "k: v",
      "2026-07-28 21:15:03",
    ]);

    const blankDetail = renderAlertMessage({
      alert: { source: "agent", event: "e", severity: "warn", title: "t", detail: "   \n  " },
      occurredAt: OCCURRED_AT,
      suppressedSinceLast: 0,
    });
    expect(blankDetail).toBe(["【warn】agent · e", "t", "2026-07-28 21:15:03"].join("\n"));
  });

  it("被压制过时末行说明次数", () => {
    const message = renderAlertMessage({
      alert: { source: "agent", event: "e", severity: "error", title: "t" },
      occurredAt: OCCURRED_AT,
      suppressedSinceLast: 12,
    });

    expect(message.endsWith("距上次同类告警之间另有 12 次被压制。")).toBe(true);
  });

  it("detail 超长按 Unicode 码点截断，绝不劈开代理对（#187 那类 lone surrogate 事故）", () => {
    // 1500 个 emoji（各 2 个 UTF-16 code unit）后再跟一个，超限 1 个码点。
    const detail = "🐟".repeat(1501);
    const message = renderAlertMessage({
      alert: { source: "agent", event: "e", severity: "warn", title: "t", detail },
      occurredAt: OCCURRED_AT,
      suppressedSinceLast: 0,
    });

    const detailLine = message.split("\n")[2];
    expect([...detailLine]).toHaveLength(1501); // 1500 个 emoji + 省略号
    expect(detailLine.endsWith("…")).toBe(true);
    // 关键断言：不含孤立代理项——按 UTF-16 slice 的实现会在这里留下半个 emoji。
    expect(/[\uD800-\uDFFF]/.test(detailLine.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))).toBe(
      false,
    );
  });

  it("detail 恰好等于上限时不截断、不加省略号", () => {
    const detail = "鱼".repeat(1500);
    const message = renderAlertMessage({
      alert: { source: "agent", event: "e", severity: "warn", title: "t", detail },
      occurredAt: OCCURRED_AT,
      suppressedSinceLast: 0,
    });

    expect(message.split("\n")[2]).toBe(detail);
  });
});
