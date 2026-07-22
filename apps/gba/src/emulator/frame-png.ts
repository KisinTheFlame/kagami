import { PNG } from "pngjs";
import type { GbaFrameRgba } from "./emulator-core.js";

/** 截图放大倍数：240×160 → 480×320（最近邻），给多模态阅读留清晰度、控制 token 体积。 */
const SCALE = 2;

/** 把一帧 RGBA 编码成 PNG（最近邻放大 SCALE 倍）。 */
export function encodeFramePng(frame: GbaFrameRgba): Buffer {
  const { width, height, pixels } = frame;
  const outWidth = width * SCALE;
  const outHeight = height * SCALE;
  const png = new PNG({ width: outWidth, height: outHeight });
  for (let y = 0; y < outHeight; y++) {
    const srcY = Math.floor(y / SCALE);
    for (let x = 0; x < outWidth; x++) {
      const srcX = Math.floor(x / SCALE);
      const src = (srcY * width + srcX) * 4;
      const out = (y * outWidth + x) * 4;
      png.data[out] = pixels[src] ?? 0;
      png.data[out + 1] = pixels[src + 1] ?? 0;
      png.data[out + 2] = pixels[src + 2] ?? 0;
      png.data[out + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
