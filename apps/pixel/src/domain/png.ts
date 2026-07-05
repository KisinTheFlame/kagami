import { PNG } from "pngjs";
import { rgbaByGlyph } from "@kagami/pixel-api/palette";
import type { CanvasSnapshot } from "./canvas.js";

// === 画布 → PNG（pngjs，最近邻整数放大）===
//
// 16px 的原图太小看不清：整数倍放大到 ~256px（scale = max(1, floor(256/max(w,h)))）。
// 空格子 = 透明（alpha 0），适合贴纸式的图。

const RENDER_TARGET_PX = 256;

export function renderScale(width: number, height: number): number {
  return Math.max(1, Math.floor(RENDER_TARGET_PX / Math.max(width, height)));
}

/** 把画布快照编码成放大后的 PNG 字节。 */
export function renderCanvasPng(snapshot: CanvasSnapshot): Buffer {
  const scale = renderScale(snapshot.width, snapshot.height);
  const outWidth = snapshot.width * scale;
  const outHeight = snapshot.height * scale;
  const png = new PNG({ width: outWidth, height: outHeight });

  for (let sy = 0; sy < snapshot.height; sy += 1) {
    const row = snapshot.cells[sy] ?? "";
    for (let sx = 0; sx < snapshot.width; sx += 1) {
      const glyph = row[sx] ?? ".";
      const [r, g, b, a] = rgbaByGlyph(glyph);
      // 该源格放大成 scale×scale 块。
      for (let dy = 0; dy < scale; dy += 1) {
        const py = sy * scale + dy;
        for (let dx = 0; dx < scale; dx += 1) {
          const px = sx * scale + dx;
          const idx = (py * outWidth + px) * 4;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = a;
        }
      }
    }
  }

  return PNG.sync.write(png);
}
