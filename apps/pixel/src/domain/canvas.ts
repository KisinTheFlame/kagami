import { colorByName, EMPTY_GLYPH, nameByGlyph, PALETTE_NAMES } from "@kagami/pixel-api/palette";
import { MAX_CANVAS_SIZE, type CanvasState } from "@kagami/pixel-api/contract";
import { CanvasRejectError } from "./errors.js";

// === 画布模型 + 绘图算子（纯领域，无 I/O）===
//
// 格子矩阵行优先，每格是一个 glyph 字符（EMPTY_GLYPH = 空/透明）。
// - 无效颜色：所有算子拒绝。
// - set_pixels / fill 的显式坐标越界：拒绝（不静默吞用户的明确错误）。
// - line / rect / circle / ellipse：几何工具，超出画布的像素裁掉（clip）——画半个圆是常见需求。

/** 画布快照（持久化载体）：只存尺寸 + 行字符串。 */
export type CanvasSnapshot = {
  width: number;
  height: number;
  cells: string[];
};

export type PixelInput = { x: number; y: number; color: string };

function resolveGlyph(colorName: string): string {
  const color = colorByName(colorName);
  if (!color) {
    throw new CanvasRejectError(`未知颜色 "${colorName}"，可用: ${PALETTE_NAMES.join(", ")}`);
  }
  return color.glyph;
}

export class PixelCanvas {
  public readonly width: number;
  public readonly height: number;
  /** 行优先，cells[y][x] 是单个 glyph 字符。 */
  private readonly cells: string[][];

  private constructor(width: number, height: number, cells: string[][]) {
    this.width = width;
    this.height = height;
    this.cells = cells;
  }

  /** 建一块全空画布。尺寸越界由契约 schema 兜，这里再防御一次。 */
  public static create(width: number, height: number): PixelCanvas {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > MAX_CANVAS_SIZE ||
      height > MAX_CANVAS_SIZE
    ) {
      throw new CanvasRejectError(`画布尺寸需在 1..${MAX_CANVAS_SIZE}，收到 ${width}×${height}`);
    }
    const cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => EMPTY_GLYPH),
    );
    return new PixelCanvas(width, height, cells);
  }

  /** 从快照恢复；形状不符抛错（由持久化层捕获后当坏档处理）。 */
  public static fromSnapshot(snapshot: CanvasSnapshot): PixelCanvas {
    const canvas = PixelCanvas.create(snapshot.width, snapshot.height);
    if (snapshot.cells.length !== snapshot.height) {
      throw new CanvasRejectError("快照行数与 height 不符");
    }
    for (let y = 0; y < snapshot.height; y += 1) {
      const row = snapshot.cells[y];
      if (row === undefined || row.length !== snapshot.width) {
        throw new CanvasRejectError("快照某行长度与 width 不符");
      }
      for (let x = 0; x < snapshot.width; x += 1) {
        const glyph = row[x] as string;
        // 空格或已知 glyph 才收，未知一律当空（防坏档注入乱字符）。
        canvas.cells[y][x] = glyph === EMPTY_GLYPH || nameByGlyph(glyph) ? glyph : EMPTY_GLYPH;
      }
    }
    return canvas;
  }

  public toSnapshot(): CanvasSnapshot {
    return {
      width: this.width,
      height: this.height,
      cells: this.cells.map(row => row.join("")),
    };
  }

  public toState(): CanvasState {
    const used = new Set<string>();
    for (const row of this.cells) {
      for (const glyph of row) {
        if (glyph !== EMPTY_GLYPH) {
          const name = nameByGlyph(glyph);
          if (name) {
            used.add(name);
          }
        }
      }
    }
    return {
      width: this.width,
      height: this.height,
      cells: this.cells.map(row => row.join("")),
      // 按调色板顺序输出用到的色，图例稳定（KV 友好）。
      colors: PALETTE_NAMES.filter(name => used.has(name)),
    };
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** 越界静默跳过（供 clip 型几何算子用）。 */
  private plot(x: number, y: number, glyph: string): void {
    if (this.inBounds(x, y)) {
      this.cells[y][x] = glyph;
    }
  }

  /** 批量点：先全校验（颜色 + 越界）后应用，任一非法整批拒绝，不部分写。 */
  public setPixels(pixels: readonly PixelInput[]): void {
    const resolved = pixels.map(pixel => {
      const glyph = resolveGlyph(pixel.color);
      if (!this.inBounds(pixel.x, pixel.y)) {
        throw new CanvasRejectError(
          `坐标越界 (${pixel.x},${pixel.y})，画布是 ${this.width}×${this.height}`,
        );
      }
      return { x: pixel.x, y: pixel.y, glyph };
    });
    for (const { x, y, glyph } of resolved) {
      this.cells[y][x] = glyph;
    }
  }

  /** 4-连通油漆桶。起点越界拒绝（显式坐标）。 */
  public fill(x: number, y: number, color: string): void {
    const glyph = resolveGlyph(color);
    if (!this.inBounds(x, y)) {
      throw new CanvasRejectError(`坐标越界 (${x},${y})，画布是 ${this.width}×${this.height}`);
    }
    const target = this.cells[y][x];
    if (target === glyph) {
      return; // 起点已是目标色，无操作（也避免自环）。
    }
    const stack: [number, number][] = [[x, y]];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop() as [number, number];
      if (!this.inBounds(cx, cy) || this.cells[cy][cx] !== target) {
        continue;
      }
      this.cells[cy][cx] = glyph;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  /** Bresenham 直线，超出画布的点裁掉。 */
  public line(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const glyph = resolveGlyph(color);
    this.drawLine(x1, y1, x2, y2, glyph);
  }

  private drawLine(x1: number, y1: number, x2: number, y2: number, glyph: string): void {
    let x = x1;
    let y = y1;
    const dx = Math.abs(x2 - x1);
    const dy = -Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.plot(x, y, glyph);
      if (x === x2 && y === y2) {
        break;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** 矩形（描边或填充），超出画布裁掉。 */
  public rect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    filled: boolean,
  ): void {
    const glyph = resolveGlyph(color);
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    if (filled) {
      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          this.plot(x, y, glyph);
        }
      }
      return;
    }
    for (let x = left; x <= right; x += 1) {
      this.plot(x, top, glyph);
      this.plot(x, bottom, glyph);
    }
    for (let y = top; y <= bottom; y += 1) {
      this.plot(left, y, glyph);
      this.plot(right, y, glyph);
    }
  }

  /** 中点画圆（描边或填充），超出画布裁掉。 */
  public circle(cx: number, cy: number, radius: number, color: string, filled: boolean): void {
    const glyph = resolveGlyph(color);
    if (radius <= 0) {
      this.plot(cx, cy, glyph);
      return;
    }
    let x = radius;
    let y = 0;
    let err = 1 - radius;
    while (x >= y) {
      if (filled) {
        this.hLine(cx - x, cx + x, cy + y, glyph);
        this.hLine(cx - x, cx + x, cy - y, glyph);
        this.hLine(cx - y, cx + y, cy + x, glyph);
        this.hLine(cx - y, cx + y, cy - x, glyph);
      } else {
        this.plot(cx + x, cy + y, glyph);
        this.plot(cx - x, cy + y, glyph);
        this.plot(cx + x, cy - y, glyph);
        this.plot(cx - x, cy - y, glyph);
        this.plot(cx + y, cy + x, glyph);
        this.plot(cx - y, cy + x, glyph);
        this.plot(cx + y, cy - x, glyph);
        this.plot(cx - y, cy - x, glyph);
      }
      y += 1;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x -= 1;
        err += 2 * (y - x) + 1;
      }
    }
  }

  /** 中点椭圆（描边或填充），超出画布裁掉。 */
  public ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: string,
    filled: boolean,
  ): void {
    const glyph = resolveGlyph(color);
    const a = Math.max(rx, 0);
    const b = Math.max(ry, 0);
    // 退化轴：任一半径为 0，中点算法的区域循环覆盖不到，显式画线/点。
    // 必须与 rx=0（竖线）对称处理 ry=0（横线），否则 ry=0 只剩中心一个点。
    if (a <= 0 || b <= 0) {
      if (a <= 0 && b <= 0) {
        this.plot(cx, cy, glyph);
      } else if (b <= 0) {
        this.hLine(cx - a, cx + a, cy, glyph); // ry=0 → 横线
      } else {
        for (let yy = cy - b; yy <= cy + b; yy += 1) {
          this.plot(cx, yy, glyph); // rx=0 → 竖线
        }
      }
      return;
    }
    const emit = (x: number, y: number): void => {
      if (filled) {
        this.hLine(cx - x, cx + x, cy + y, glyph);
        this.hLine(cx - x, cx + x, cy - y, glyph);
      } else {
        this.plot(cx + x, cy + y, glyph);
        this.plot(cx - x, cy + y, glyph);
        this.plot(cx + x, cy - y, glyph);
        this.plot(cx - x, cy - y, glyph);
      }
    };
    const a2 = a * a;
    const b2 = b * b;
    let x = 0;
    let y = b;
    let px = 0;
    let py = 2 * a2 * y;
    emit(x, y);
    // 区域 1
    let p = Math.round(b2 - a2 * b + 0.25 * a2);
    while (px < py) {
      x += 1;
      px += 2 * b2;
      if (p < 0) {
        p += b2 + px;
      } else {
        y -= 1;
        py -= 2 * a2;
        p += b2 + px - py;
      }
      emit(x, y);
    }
    // 区域 2
    p = Math.round(b2 * (x + 0.5) * (x + 0.5) + a2 * (y - 1) * (y - 1) - a2 * b2);
    while (y > 0) {
      y -= 1;
      py -= 2 * a2;
      if (p > 0) {
        p += a2 - py;
      } else {
        x += 1;
        px += 2 * b2;
        p += a2 - py + px;
      }
      emit(x, y);
    }
  }

  private hLine(x1: number, x2: number, y: number, glyph: string): void {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    for (let x = left; x <= right; x += 1) {
      this.plot(x, y, glyph);
    }
  }

  /** 清空为全空，保留尺寸。 */
  public clear(): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.cells[y][x] = EMPTY_GLYPH;
      }
    }
  }
}
