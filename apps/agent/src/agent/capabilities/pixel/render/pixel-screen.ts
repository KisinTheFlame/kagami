import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { colorByName, EMPTY_GLYPH } from "@kagami/pixel-api/palette";
import type { CanvasResponse, CanvasState } from "@kagami/pixel-api/contract";

// === CanvasState → 文字屏幕（走 .hbs 模板）===
//
// 渲染放 agent 侧（分工原则）：调屏幕文案不用重部署像素画服务。TS 只算 view-model
// （网格 / 图例是结构标识符，计数 / 布尔 flag），所有成句文案在 apps/agent/static 下模板。
//
// #10=A：绘图工具回摘要（renderCanvasSummary），show_canvas 才回完整带标尺网格
// （renderCanvasScreen）——避免每步全画布（64×64 每步 ~4KB）撑爆上下文。

/** 带坐标标尺的完整网格（结构，非语气文案）。列头是列号 mod 10，左侧是行号。 */
function buildGrid(state: CanvasState): string {
  const rowDigits = String(state.height - 1).length;
  const colHeader = Array.from({ length: state.width }, (_, i) => String(i % 10)).join("");
  const headerLine = `${" ".repeat(rowDigits + 1)}${colHeader}`;
  const rows = state.cells.map((row, y) => `${String(y).padStart(rowDigits, " ")} ${row}`);
  return [headerLine, ...rows].join("\n");
}

/** 图例：只列本画布用到的色，`glyph=name`（结构标识符）。空画布返回空串。 */
function buildLegend(state: CanvasState): string {
  return state.colors
    .map(name => {
      const glyph = colorByName(name)?.glyph ?? "?";
      return `${glyph}=${name}`;
    })
    .join("  ");
}

function countFilled(state: CanvasState): number {
  let filled = 0;
  for (const row of state.cells) {
    for (const glyph of row) {
      if (glyph !== EMPTY_GLYPH) {
        filled += 1;
      }
    }
  }
  return filled;
}

/** 完整网格屏（show_canvas / render 之外看进度用）。 */
export function renderCanvasScreen(state: CanvasState): string {
  const legend = buildLegend(state);
  return renderServerStaticTemplate(import.meta.url, "context/pixel-screen.hbs", {
    grid: buildGrid(state),
    legend,
    hasLegend: legend.length > 0,
    width: state.width,
    height: state.height,
  });
}

/** 绘图工具的紧凑摘要（不回全网格，省 token）。 */
export function renderCanvasSummary(state: CanvasState): string {
  const filled = countFilled(state);
  return renderServerStaticTemplate(import.meta.url, "context/pixel-summary.hbs", {
    width: state.width,
    height: state.height,
    filled,
    total: state.width * state.height,
    colors: state.colors.join("、"),
    hasColors: state.colors.length > 0,
  });
}

/** 领域拒绝（无效颜色 / 越界 / 无画布）的可读反馈。 */
export function renderCanvasReject(reason: string): string {
  return renderServerStaticTemplate(import.meta.url, "context/pixel-reject.hbs", { reason });
}

/** 绘图工具的响应 → 屏幕：成功回摘要，领域拒绝回可读原因。 */
export function renderDrawResponse(response: CanvasResponse): string {
  return response.ok ? renderCanvasSummary(response.canvas) : renderCanvasReject(response.reason);
}

/** show_canvas 的响应 → 屏幕：成功回完整网格，无画布 / 拒绝回可读原因。 */
export function renderShowResponse(response: CanvasResponse): string {
  return response.ok ? renderCanvasScreen(response.canvas) : renderCanvasReject(response.reason);
}

/** 进入像素画 App 的静态定位屏（onFocus，纯本地渲染，无 I/O）。 */
export function renderPixelPortal(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/pixel-portal.hbs");
}
