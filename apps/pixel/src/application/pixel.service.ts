import type { CanvasState } from "@kagami/pixel-api/contract";
import { PixelCanvas, type PixelInput } from "../domain/canvas.js";
import { CanvasRejectError } from "../domain/errors.js";
import { renderCanvasPng } from "../domain/png.js";
import type { SaveStore } from "../persistence/save-store.js";

// === 像素画服务：持有内存「当前画布」+ 存档 ===
//
// 单块画布。绘图算子在内存改动同步完成，再排队原子落盘（SaveStore 串行写链）。
// 领域拒绝（无效颜色 / 越界 / 无画布）以 CanvasRejectError 抛出，由 handler 捕获成
// { ok:false, reason } 的 CanvasResponse——不是服务故障。

export class PixelService {
  private readonly store: SaveStore;
  private canvas: PixelCanvas | null = null;

  public constructor({ store }: { store: SaveStore }) {
    this.store = store;
  }

  /** 启动时从存档恢复；坏档 / 无档 → 无画布。 */
  public async init(): Promise<void> {
    const snapshot = await this.store.load();
    if (!snapshot) {
      this.canvas = null;
      return;
    }
    try {
      this.canvas = PixelCanvas.fromSnapshot(snapshot);
    } catch {
      this.canvas = null; // load 已做过校验，这里是双保险。
    }
  }

  /** 当前画布状态（无画布返回 null，供 handler 组 { ok:false, canvas:null }）。 */
  public currentState(): CanvasState | null {
    return this.canvas ? this.canvas.toState() : null;
  }

  private requireCanvas(): PixelCanvas {
    if (!this.canvas) {
      throw new CanvasRejectError("还没有画布，先用 new_canvas 起手。");
    }
    return this.canvas;
  }

  private async persist(): Promise<CanvasState> {
    const canvas = this.requireCanvas();
    await this.store.save(canvas.toSnapshot());
    return canvas.toState();
  }

  public async newCanvas(width: number, height: number): Promise<CanvasState> {
    this.canvas = PixelCanvas.create(width, height);
    return this.persist();
  }

  public async setPixels(pixels: readonly PixelInput[]): Promise<CanvasState> {
    this.requireCanvas().setPixels(pixels);
    return this.persist();
  }

  public async fill(x: number, y: number, color: string): Promise<CanvasState> {
    this.requireCanvas().fill(x, y, color);
    return this.persist();
  }

  public async line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): Promise<CanvasState> {
    this.requireCanvas().line(x1, y1, x2, y2, color);
    return this.persist();
  }

  public async rect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasState> {
    this.requireCanvas().rect(x1, y1, x2, y2, color, filled);
    return this.persist();
  }

  public async circle(
    cx: number,
    cy: number,
    radius: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasState> {
    this.requireCanvas().circle(cx, cy, radius, color, filled);
    return this.persist();
  }

  public async ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: string,
    filled: boolean,
  ): Promise<CanvasState> {
    this.requireCanvas().ellipse(cx, cy, rx, ry, color, filled);
    return this.persist();
  }

  public async clear(): Promise<CanvasState> {
    this.requireCanvas().clear();
    return this.persist();
  }

  /** 渲染当前画布为 PNG；无画布抛 CanvasRejectError（由 render 路由映射成 409）。 */
  public renderPng(): Buffer {
    return renderCanvasPng(this.requireCanvas().toSnapshot());
  }

  /** 关停时排空存档写队列。 */
  public flush(): Promise<void> {
    return this.store.flush();
  }
}
