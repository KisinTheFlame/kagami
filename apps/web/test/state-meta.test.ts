import { describe, expect, it } from "vitest";
import { stateSeriesMeta } from "@/components/metric/state-meta";

// 「状态时间占比」图只显式钉两个语义状态（DESIGN.md），其余状态一律回落后端原始 tag + 轮转色。
describe("stateSeriesMeta 解析器", () => {
  it("wait = 语义黄 + 中文名「等待」（DESIGN.md 钉死）", () => {
    expect(stateSeriesMeta("wait", 0)).toEqual({ label: "等待", color: "hsl(var(--scheduler))" });
  });

  it("portal = 中性弱色 + 中文名「桌面」", () => {
    expect(stateSeriesMeta("portal", 1)).toEqual({
      label: "桌面",
      color: "hsl(var(--muted-foreground))",
    });
  });

  it("其余状态（App / 新增漂移）返回 undefined → 回落后端原始 tag + 轮转色，绝不再出现「未知」", () => {
    // 已知 App：不再维护名字/配色映射，图例直接用原始 tag。
    expect(stateSeriesMeta("qq", 2)).toBeUndefined();
    // gba 曾漏在旧表里显示成「未知（gba）」；现在回落成原始 tag "gba"。
    expect(stateSeriesMeta("gba", 3)).toBeUndefined();
    // 未来任意新增 App：零维护，同样回落，不会「未知」。
    expect(stateSeriesMeta("brand_new_app", 4)).toBeUndefined();
  });
});
