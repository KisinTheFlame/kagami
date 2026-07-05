// === 像素画调色板（单一事实源，issue #365）===
//
// 服务用 hex 编码 PNG、agent 用 name/glyph 写工具文档与文本网格，两端共享这一份常量。
// 采用 DawnBringer 16（业界成熟像素画调色板）里的 15 色 + 空/透明。name/glyph 由我们定，
// hex 锁 DB16。glyph 只用于文本网格显示；工具的 color 参数一律取 name（不接受 glyph）。

/** 空格子的 glyph：渲染 PNG 时为透明（alpha 0）。 */
export const EMPTY_GLYPH = ".";

export type PixelColor = {
  /** 工具 color 参数取的名字（如 "red"）。 */
  readonly name: string;
  /** 文本网格里单格显示的字符。 */
  readonly glyph: string;
  /** PNG 编码用的十六进制色值（不含 '#'）。 */
  readonly hex: string;
};

/** DB16 的 15 色（名字/glyph 我们定，hex 锁 DB16）。顺序即 help / 图例的展示顺序。 */
export const PIXEL_PALETTE: readonly PixelColor[] = [
  { name: "black", glyph: "k", hex: "140c1c" },
  { name: "darkgray", glyph: "d", hex: "4e4a4e" },
  { name: "gray", glyph: "a", hex: "8595a1" },
  { name: "white", glyph: "w", hex: "deeed6" },
  { name: "red", glyph: "r", hex: "d04648" },
  { name: "orange", glyph: "o", hex: "d27d2c" },
  { name: "brown", glyph: "n", hex: "854c30" },
  { name: "yellow", glyph: "y", hex: "dad45e" },
  { name: "green", glyph: "g", hex: "6daa2c" },
  { name: "darkgreen", glyph: "f", hex: "346524" },
  { name: "blue", glyph: "b", hex: "597dce" },
  { name: "darkblue", glyph: "e", hex: "30346d" },
  { name: "cyan", glyph: "c", hex: "6dc2ca" },
  { name: "purple", glyph: "p", hex: "442434" },
  { name: "tan", glyph: "t", hex: "d2aa99" },
];

const NAME_TO_COLOR = new Map<string, PixelColor>(PIXEL_PALETTE.map(c => [c.name, c]));
const GLYPH_TO_COLOR = new Map<string, PixelColor>(PIXEL_PALETTE.map(c => [c.glyph, c]));

/** 已知颜色 name → PixelColor；未知 name 返回 undefined（调用方据此判非法）。 */
export function colorByName(name: string): PixelColor | undefined {
  return NAME_TO_COLOR.get(name);
}

/** glyph → 颜色 name；空格子或未知 glyph 返回 undefined。 */
export function nameByGlyph(glyph: string): string | undefined {
  return GLYPH_TO_COLOR.get(glyph)?.name;
}

/** 全部可用颜色 name（工具文档 / 报错时列出）。 */
export const PALETTE_NAMES: readonly string[] = PIXEL_PALETTE.map(c => c.name);

export type Rgba = readonly [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

const GLYPH_TO_RGBA = new Map<string, Rgba>(
  PIXEL_PALETTE.map(c => {
    const r = parseInt(c.hex.slice(0, 2), 16);
    const g = parseInt(c.hex.slice(2, 4), 16);
    const b = parseInt(c.hex.slice(4, 6), 16);
    return [c.glyph, [r, g, b, 255] as Rgba];
  }),
);

/** glyph → RGBA（PNG 编码用）。空格子 / 未知 glyph → 透明。 */
export function rgbaByGlyph(glyph: string): Rgba {
  return GLYPH_TO_RGBA.get(glyph) ?? TRANSPARENT;
}
