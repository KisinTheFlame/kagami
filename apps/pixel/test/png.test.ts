import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { renderCanvasPng, renderScale } from "../src/domain/png.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("renderScale — 最近邻整数放大到 ~256px", () => {
  it("16→16、64→4、2→128", () => {
    expect(renderScale(16, 16)).toBe(16);
    expect(renderScale(64, 64)).toBe(4);
    expect(renderScale(2, 2)).toBe(128);
  });
});

describe("renderCanvasPng", () => {
  it("产出合法 PNG（magic bytes），尺寸 = 原始 × scale", () => {
    const png = renderCanvasPng({ width: 16, height: 16, cells: Array(16).fill(".".repeat(16)) });
    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
    const parsed = PNG.sync.read(png);
    expect(parsed.width).toBe(256);
    expect(parsed.height).toBe(256);
  });

  it("空格子透明（alpha 0），实色格子不透明且颜色正确", () => {
    // 2×1：左 red，右空。scale=128 → 256×128。
    const png = renderCanvasPng({ width: 2, height: 1, cells: ["r."] });
    const parsed = PNG.sync.read(png);
    const at = (x: number, y: number): [number, number, number, number] => {
      const idx = (y * parsed.width + x) * 4;
      return [parsed.data[idx], parsed.data[idx + 1], parsed.data[idx + 2], parsed.data[idx + 3]];
    };
    // 左半格 = red #d04648 = (208,70,72,255)。
    expect(at(0, 0)).toEqual([208, 70, 72, 255]);
    // 右半格（第二个源格）= 空 → 透明。
    expect(at(200, 0)[3]).toBe(0);
  });
});
