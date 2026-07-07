import { describe, expect, it } from "vitest";
import { STATE_META, STATE_FALLBACK, stateSeriesMeta } from "@/components/metric/state-meta";

// 后端已注册的 11 个 App id（对齐 apps/agent agent-runtime.factory 的注册表）+ 两个语义状态。
// AppId 是 string 无可枚举源，这里钉住已知集合：删掉任一映射即回归，防止漂移丢色/丢 label。
const KNOWN_APP_IDS = [
  "calc",
  "terminal",
  "ithome",
  "todo",
  "clock",
  "hn",
  "amap",
  "browser",
  "spire",
  "pixel",
  "qq",
] as const;

describe("STATE_META", () => {
  it("覆盖全部 11 个已知 App id + wait + portal", () => {
    for (const id of KNOWN_APP_IDS) {
      expect(STATE_META[id], `缺 App 状态映射: ${id}`).toBeDefined();
    }
    expect(STATE_META.wait).toBeDefined();
    expect(STATE_META.portal).toBeDefined();
  });

  it("wait = 语义黄（--scheduler = 等待），符合 DESIGN.md", () => {
    expect(STATE_META.wait?.color).toBe("hsl(var(--scheduler))");
    expect(STATE_META.wait?.label).toBe("等待");
  });

  it("portal 用中性弱色", () => {
    expect(STATE_META.portal?.color).toBe("hsl(var(--muted-foreground))");
  });

  it("每个状态颜色互不相同（同图多带不撞色）", () => {
    const colors = Object.values(STATE_META).map(meta => meta.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("stateSeriesMeta 解析器", () => {
  it("命中 STATE_META 时返回其 label + color", () => {
    expect(stateSeriesMeta("qq", 0)).toEqual(STATE_META.qq);
    expect(stateSeriesMeta("wait", 5)).toEqual(STATE_META.wait);
  });

  it("未命中（新增 App 漂移）时回落到 STATE_FALLBACK 色 + 带 id 的 label，不缺色不崩", () => {
    const resolved = stateSeriesMeta("brand_new_app", 3);
    expect(resolved?.color).toBe(STATE_FALLBACK.color);
    expect(resolved?.label).toContain("brand_new_app");
  });
});
