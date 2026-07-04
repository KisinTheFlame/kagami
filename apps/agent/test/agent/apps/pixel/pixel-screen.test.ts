import { describe, expect, it } from "vitest";
import type { CanvasState } from "@kagami/pixel-api/contract";
import {
  renderCanvasReject,
  renderCanvasScreen,
  renderCanvasSummary,
  renderDrawResponse,
  renderShowResponse,
} from "../../../../src/agent/capabilities/pixel/render/pixel-screen.js";

const STATE: CanvasState = {
  width: 4,
  height: 2,
  cells: ["r...", "..k."],
  colors: ["black", "red"],
};

describe("renderCanvasScreen — 完整网格", () => {
  it("含坐标标尺、画布内容、图例只列用到色", () => {
    const screen = renderCanvasScreen(STATE);
    expect(screen).toContain("<pixel_canvas>");
    expect(screen).toContain("r...");
    expect(screen).toContain("..k.");
    // 列头是列号 mod 10。
    expect(screen).toContain("0123");
    // 图例只列用到的色（黑、红），不列没用到的。
    expect(screen).toContain("k=black");
    expect(screen).toContain("r=red");
    expect(screen).not.toContain("=blue");
  });

  it("空画布提示还是空", () => {
    const empty: CanvasState = { width: 2, height: 2, cells: ["..", ".."], colors: [] };
    expect(renderCanvasScreen(empty)).toContain("还是空画布");
  });
});

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

  it("renderShowResponse：ok 回完整网格", () => {
    expect(renderShowResponse({ ok: true, canvas: STATE })).toContain("r...");
  });
});
