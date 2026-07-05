import { describe, expect, it } from "vitest";
import type { CanvasState } from "@kagami/pixel-api/contract";
import {
  renderCanvasReject,
  renderCanvasSummary,
  renderDrawResponse,
} from "../../../../src/agent/capabilities/pixel/render/pixel-screen.js";

const STATE: CanvasState = {
  width: 4,
  height: 2,
  cells: ["r...", "..k."],
  colors: ["black", "red"],
};

describe("renderCanvasSummary — 摘要", () => {
  it("回填色计数与用色，不含完整网格行", () => {
    const summary = renderCanvasSummary(STATE);
    expect(summary).toContain("已填 2/8 格");
    expect(summary).toContain("black");
    expect(summary).toContain("red");
    expect(summary).not.toContain("..k.");
  });
});

describe("renderCanvasReject / 响应格式化", () => {
  it("reject 带回原因", () => {
    expect(renderCanvasReject('未知颜色 "nope"')).toContain("未知颜色");
  });

  it("renderDrawResponse：ok 回摘要，拒绝回原因", () => {
    expect(renderDrawResponse({ ok: true, canvas: STATE })).toContain("已填");
    expect(renderDrawResponse({ ok: false, reason: "越界啦", canvas: null })).toContain("越界啦");
  });
});
