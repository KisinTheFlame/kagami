import { describe, expect, it } from "vitest";
import { detectMime } from "../../src/oss/detect-mime.js";

/** 拼一个以指定字节开头、后面补零的 buffer，模拟真实文件头。 */
function withMagic(...head: number[]): Buffer {
  return Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);
}

const PNG = withMagic(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = withMagic(0xff, 0xd8, 0xff, 0xe0);
const GIF = Buffer.from("GIF89a\0\0\0\0", "latin1");
const BMP = Buffer.from("BM\0\0\0\0\0\0", "latin1");
const WEBP = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");
const AVIF = Buffer.from("\0\0\0\x20ftypavif\0\0\0\0", "latin1");
const HEIC = Buffer.from("\0\0\0\x20ftypheic\0\0\0\0", "latin1");
// 泛 HEIF 容器（major brand mif1）：刻意不归一为 heic，回落到 header / octet-stream。
const HEIF_MIF1 = Buffer.from("\0\0\0\x20ftypmif1\0\0\0\0", "latin1");

describe("detectMime", () => {
  it("识别 PNG / JPEG / GIF / WebP / BMP / AVIF / HEIC 的 magic bytes", () => {
    expect(detectMime(PNG)).toBe("image/png");
    expect(detectMime(JPEG)).toBe("image/jpeg");
    expect(detectMime(GIF)).toBe("image/gif");
    expect(detectMime(WEBP)).toBe("image/webp");
    expect(detectMime(BMP)).toBe("image/bmp");
    expect(detectMime(AVIF)).toBe("image/avif");
    expect(detectMime(HEIC)).toBe("image/heic");
  });

  it("泛 HEIF brand(mif1) 不误标 heic，回落 header / octet-stream", () => {
    expect(detectMime(HEIF_MIF1)).toBe("application/octet-stream");
    expect(detectMime(HEIF_MIF1, "image/avif")).toBe("image/avif");
  });

  it("GIF8 但第 5 字节非 7/9 不误判为 gif", () => {
    // "GIF80"：前缀 GIF8 但不是 87a/89a，应回落
    const fakeGif = Buffer.from("GIF80aaa", "latin1");
    expect(detectMime(fakeGif)).toBe("application/octet-stream");
  });

  it("magic 命中时无视 header（字节比 header 权威）", () => {
    expect(detectMime(PNG, "text/html")).toBe("image/png");
    expect(detectMime(PNG, "image/jpeg")).toBe("image/png");
  });

  it("认不出字节 + 无 image header → application/octet-stream", () => {
    expect(detectMime(Buffer.from("not an image"))).toBe("application/octet-stream");
    expect(detectMime(Buffer.from("html"), "text/html")).toBe("application/octet-stream");
  });

  it("认不出字节 + image/* header → 信任 header（决策 A 兜底）", () => {
    expect(detectMime(Buffer.from("weird"), "image/png")).toBe("image/png");
    // 带 charset/参数也要剥掉
    expect(detectMime(Buffer.from("weird"), "image/svg+xml; charset=utf-8")).toBe("image/svg+xml");
  });

  it("空 buffer 不崩，回退 octet-stream", () => {
    expect(detectMime(Buffer.alloc(0))).toBe("application/octet-stream");
    expect(detectMime(Buffer.alloc(0), "image/png")).toBe("image/png");
  });
});
