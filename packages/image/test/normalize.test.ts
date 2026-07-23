import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { clampToApiLimit, normalizeImageForLlm } from "../src/normalize.js";

/** 纯内存生成测试图（无文件 IO）：纯色 jpeg/png，尺寸任意。 */
async function makeImage(
  width: number,
  height: number,
  format: "jpeg" | "png" = "jpeg",
): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 130, b: 140 },
    },
  });
  return format === "png" ? pipeline.png().toBuffer() : pipeline.jpeg().toBuffer();
}

async function sizeOf(bytes: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

describe("normalizeImageForLlm", () => {
  it("小图直通：字节原样返回，不重编码", async () => {
    const input = await makeImage(800, 600);
    const result = await normalizeImageForLlm(input, "image/jpeg");
    expect(result.transformed).toBe(false);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].bytes).toBe(input);
    expect(result.parts[0].mimeType).toBe("image/jpeg");
  });

  it("宽高比 >4 但长边 ≤1568 仍直通", async () => {
    const input = await makeImage(100, 500);
    const result = await normalizeImageForLlm(input, "image/jpeg");
    expect(result.transformed).toBe(false);
    expect(result.parts[0].bytes).toBe(input);
  });

  it("普通比例超大图等比缩到长边 1568", async () => {
    const input = await makeImage(3000, 2000);
    const result = await normalizeImageForLlm(input, "image/jpeg");
    expect(result.transformed).toBe(true);
    expect(result.parts).toHaveLength(1);
    const { width, height } = await sizeOf(result.parts[0].bytes);
    expect(width).toBe(1568);
    expect(height).toBe(Math.round(2000 * (1568 / 3000)));
  });

  it("事故图形状（429×8183）切成 6 片、每片高 ≤1536 宽不变", async () => {
    const input = await makeImage(429, 8183);
    const result = await normalizeImageForLlm(input, "image/jpeg");
    expect(result.transformed).toBe(true);
    // N = ceil((8183 - 80) / 1456) = 6
    expect(result.parts).toHaveLength(6);
    for (const [i, part] of result.parts.entries()) {
      expect(part.tile).toEqual({ index: i + 1, total: 6 });
      const { width, height } = await sizeOf(part.bytes);
      expect(width).toBe(429);
      expect(height).toBeLessThanOrEqual(1536);
    }
  });

  it("超过 6 片覆盖上限的极端长图先整体降采样再切", async () => {
    const input = await makeImage(400, 20000);
    const result = await normalizeImageForLlm(input, "image/jpeg");
    expect(result.transformed).toBe(true);
    expect(result.parts).toHaveLength(6);
    // 长边被压到可覆盖上限 80 + 1456×6 = 8816，宽等比缩小。
    const { width } = await sizeOf(result.parts[0].bytes);
    expect(width).toBe(Math.floor(400 * (8816 / 20000)));
  });

  it("横向长图沿宽度切片", async () => {
    const input = await makeImage(8183, 429);
    const result = await normalizeImageForLlm(input, "image/jpeg");
    expect(result.parts).toHaveLength(6);
    const { width, height } = await sizeOf(result.parts[0].bytes);
    expect(height).toBe(429);
    expect(width).toBeLessThanOrEqual(1536);
  });

  it("带 alpha 的图变换后输出 png", async () => {
    const input = await sharp({
      create: {
        width: 3000,
        height: 2000,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const result = await normalizeImageForLlm(input, "image/png");
    expect(result.transformed).toBe(true);
    expect(result.parts[0].mimeType).toBe("image/png");
  });

  it("解码失败 fail-open 原样透传", async () => {
    const input = Buffer.from("not an image at all");
    const result = await normalizeImageForLlm(input, "image/jpeg");
    expect(result.transformed).toBe(false);
    expect(result.parts[0].bytes).toBe(input);
    expect(result.parts[0].mimeType).toBe("image/jpeg");
  });
});

describe("clampToApiLimit", () => {
  it("合法尺寸直通", async () => {
    const input = await makeImage(1000, 1000);
    const result = await clampToApiLimit(input, "image/jpeg");
    expect(result.clamped).toBe(false);
    expect(result.bytes).toBe(input);
  });

  it("单边超 7900 等比压进限制", async () => {
    const input = await makeImage(200, 9000);
    const result = await clampToApiLimit(input, "image/jpeg");
    expect(result.clamped).toBe(true);
    const { width, height } = await sizeOf(result.bytes);
    expect(height).toBeLessThanOrEqual(7900);
    expect(width).toBe(Math.floor(200 * (7900 / 9000)));
    expect(result.fromSize).toEqual({ width: 200, height: 9000 });
    expect(result.toSize).toEqual({ width, height });
  });

  it("总像素超 40MP 压进限制", async () => {
    const input = await makeImage(7000, 7000);
    const result = await clampToApiLimit(input, "image/jpeg");
    expect(result.clamped).toBe(true);
    const { width, height } = await sizeOf(result.bytes);
    expect(width * height).toBeLessThanOrEqual(40_000_000);
    expect(Math.max(width, height)).toBeLessThanOrEqual(7900);
  });

  it("解码失败原样透传", async () => {
    const input = Buffer.from("garbage");
    const result = await clampToApiLimit(input, "image/jpeg");
    expect(result.clamped).toBe(false);
    expect(result.bytes).toBe(input);
  });
});
