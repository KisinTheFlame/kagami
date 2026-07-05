import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { EMPTY_GLYPH } from "@kagami/pixel-api/palette";
import type { CanvasResponse, CanvasState } from "@kagami/pixel-api/contract";

// === CanvasState → 文字屏幕（走 .hbs 模板）===
//
// 渲染放 agent 侧（分工原则）：调屏幕文案不用重部署像素画服务。TS 只算 view-model
// （计数 / 布尔 flag），所有成句文案在 apps/agent/static 下模板。
//
// 绘图工具回紧凑摘要（renderCanvasSummary）：避免每步全画布（64×64 每步 ~4KB）撑爆上下文。
// 要看画面就用 render 出真图——比文字网格更直观，故不再单列 show_canvas 文字网格工具。

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

/** 进入像素画 App 的静态定位屏（onFocus，纯本地渲染，无 I/O）。 */
export function renderPixelPortal(): string {
  return renderServerStaticTemplate(import.meta.url, "prompts/pixel-portal.hbs");
}
