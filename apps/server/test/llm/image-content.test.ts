import { describe, expect, it } from "vitest";
import { imageContentToBase64 } from "@kagami/llm";

const PNG = Buffer.from("hello-image-bytes");
const BASE64 = PNG.toString("base64");

describe("imageContentToBase64", () => {
  it("base64 字符串原样返回（当前契约）", () => {
    expect(imageContentToBase64(BASE64)).toBe(BASE64);
  });

  it("Buffer 转成 base64（同进程内存中的图）", () => {
    expect(imageContentToBase64(PNG)).toBe(BASE64);
  });

  it("恢复 JSON 往返后的 Buffer 残骸 {type:'Buffer',data:[...]}（已中毒历史）", () => {
    // 这正是图片 Buffer 进持久上下文、经快照 JSON 往返后的形态——修复前 provider
    // 对它 .toString('base64') 会产出 "[object Object]" 这种无效 base64。
    const poisoned = JSON.parse(JSON.stringify(PNG)) as unknown;
    expect(poisoned).toMatchObject({ type: "Buffer" });
    expect(imageContentToBase64(poisoned)).toBe(BASE64);
  });

  it("无法识别的形态返回空串（不抛、不产出垃圾）", () => {
    expect(imageContentToBase64(null)).toBe("");
    expect(imageContentToBase64(undefined)).toBe("");
    expect(imageContentToBase64({ nope: 1 })).toBe("");
  });
});
