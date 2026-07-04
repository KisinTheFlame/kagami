import { describe, expect, it } from "vitest";
import { PixelCanvas } from "../src/domain/canvas.js";
import { CanvasRejectError } from "../src/domain/errors.js";

function rows(canvas: PixelCanvas): string[] {
  return canvas.toState().cells;
}

describe("PixelCanvas — 创建与状态", () => {
  it("新画布全空，尺寸正确，无用色", () => {
    const canvas = PixelCanvas.create(4, 3);
    const state = canvas.toState();
    expect(state.width).toBe(4);
    expect(state.height).toBe(3);
    expect(state.cells).toEqual(["....", "....", "...."]);
    expect(state.colors).toEqual([]);
  });

  it("尺寸越界抛 CanvasRejectError", () => {
    expect(() => PixelCanvas.create(0, 4)).toThrow(CanvasRejectError);
    expect(() => PixelCanvas.create(65, 4)).toThrow(CanvasRejectError);
  });
});

describe("PixelCanvas — set_pixels", () => {
  it("批量上色，colors 按调色板顺序去重", () => {
    const canvas = PixelCanvas.create(3, 1);
    canvas.setPixels([
      { x: 0, y: 0, color: "red" },
      { x: 2, y: 0, color: "black" },
    ]);
    expect(rows(canvas)).toEqual(["r.k"]);
    // black 在调色板里排在 red 前面。
    expect(canvas.toState().colors).toEqual(["black", "red"]);
  });

  it("整批原子性：任一无效颜色则整批不写", () => {
    const canvas = PixelCanvas.create(3, 1);
    expect(() =>
      canvas.setPixels([
        { x: 0, y: 0, color: "red" },
        { x: 1, y: 0, color: "not-a-color" },
      ]),
    ).toThrow(CanvasRejectError);
    expect(rows(canvas)).toEqual(["..."]); // 第一格也没写。
  });

  it("整批原子性：任一越界则整批不写", () => {
    const canvas = PixelCanvas.create(3, 1);
    expect(() =>
      canvas.setPixels([
        { x: 0, y: 0, color: "red" },
        { x: 9, y: 0, color: "red" },
      ]),
    ).toThrow(CanvasRejectError);
    expect(rows(canvas)).toEqual(["..."]);
  });
});

describe("PixelCanvas — fill", () => {
  it("4-连通把整片同色区域填掉", () => {
    const canvas = PixelCanvas.create(3, 3);
    canvas.fill(0, 0, "red");
    expect(rows(canvas)).toEqual(["rrr", "rrr", "rrr"]);
  });

  it("被隔断的区域不越过边界", () => {
    const canvas = PixelCanvas.create(3, 1);
    canvas.setPixels([{ x: 1, y: 0, color: "black" }]);
    canvas.fill(0, 0, "red"); // 只填左侧一格，被 black 挡住。
    expect(rows(canvas)).toEqual(["rk."]);
  });

  it("起点越界 / 无效颜色抛错", () => {
    const canvas = PixelCanvas.create(2, 2);
    expect(() => canvas.fill(5, 5, "red")).toThrow(CanvasRejectError);
    expect(() => canvas.fill(0, 0, "nope")).toThrow(CanvasRejectError);
  });
});

describe("PixelCanvas — 几何算子（超出画布裁掉）", () => {
  it("line 画对角线", () => {
    const canvas = PixelCanvas.create(3, 3);
    canvas.line(0, 0, 2, 2, "red");
    expect(rows(canvas)).toEqual(["r..", ".r.", "..r"]);
  });

  it("rect 描边 vs 填充", () => {
    const outline = PixelCanvas.create(4, 4);
    outline.rect(0, 0, 3, 3, "red", false);
    expect(rows(outline)).toEqual(["rrrr", "r..r", "r..r", "rrrr"]);

    const filled = PixelCanvas.create(4, 4);
    filled.rect(0, 0, 3, 3, "red", true);
    expect(rows(filled)).toEqual(["rrrr", "rrrr", "rrrr", "rrrr"]);
  });

  it("circle radius 0 是单点", () => {
    const canvas = PixelCanvas.create(3, 3);
    canvas.circle(1, 1, 0, "red", false);
    expect(rows(canvas)).toEqual(["...", ".r.", "..."]);
  });

  it("ellipse 退化轴：ry=0 画横线、rx=0 画竖线（对称）", () => {
    const flat = PixelCanvas.create(5, 3);
    flat.ellipse(2, 1, 2, 0, "red", false);
    expect(rows(flat)).toEqual([".....", "rrrrr", "....."]);

    const tall = PixelCanvas.create(5, 3);
    tall.ellipse(2, 1, 0, 1, "red", false);
    expect(rows(tall)).toEqual(["..r..", "..r..", "..r.."]);
  });

  it("ellipse 非退化描边闭合对称", () => {
    const canvas = PixelCanvas.create(5, 5);
    canvas.ellipse(2, 2, 2, 2, "red", false);
    // 半径 2 的圆/椭圆描边：四个正轴端点都在。
    const grid = rows(canvas);
    expect(grid[2][0]).toBe("r");
    expect(grid[2][4]).toBe("r");
    expect(grid[0][2]).toBe("r");
    expect(grid[4][2]).toBe("r");
  });

  it("超出画布的部分被裁掉、不抛错", () => {
    const canvas = PixelCanvas.create(3, 3);
    expect(() => canvas.line(0, 0, 10, 0, "red")).not.toThrow();
    expect(rows(canvas)).toEqual(["rrr", "...", "..."]);
  });

  it("几何算子无效颜色仍抛错", () => {
    const canvas = PixelCanvas.create(3, 3);
    expect(() => canvas.rect(0, 0, 2, 2, "bad", true)).toThrow(CanvasRejectError);
  });
});

describe("PixelCanvas — clear / 快照", () => {
  it("clear 清空但保留尺寸", () => {
    const canvas = PixelCanvas.create(2, 2);
    canvas.fill(0, 0, "red");
    canvas.clear();
    expect(rows(canvas)).toEqual(["..", ".."]);
  });

  it("toSnapshot → fromSnapshot 往返逐格相等", () => {
    const canvas = PixelCanvas.create(3, 2);
    canvas.setPixels([
      { x: 0, y: 0, color: "red" },
      { x: 2, y: 1, color: "blue" },
    ]);
    const restored = PixelCanvas.fromSnapshot(canvas.toSnapshot());
    expect(restored.toState()).toEqual(canvas.toState());
  });
});
