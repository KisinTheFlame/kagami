import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { clampRequestImages } from "../src/providers/claude-image-clamp.js";
import type { LlmChatRequest } from "../src/types.js";

async function makeJpegBase64(width: number, height: number): Promise<string> {
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer();
  return bytes.toString("base64");
}

function requestWithImage(base64: string): LlmChatRequest {
  return {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "看图" },
          { type: "image", content: base64, mimeType: "image/jpeg", filename: "x.jpg" },
        ],
      },
    ],
    tools: [],
    toolChoice: "none",
  };
}

describe("clampRequestImages", () => {
  it("合法图片零拷贝直通：返回原 request 引用", async () => {
    const request = requestWithImage(await makeJpegBase64(800, 600));
    const result = await clampRequestImages(request);
    expect(result).toBe(request);
  });

  it("超限图片被确定性降采样进 7900px 内", async () => {
    const request = requestWithImage(await makeJpegBase64(120, 9000));
    const result = await clampRequestImages(request);
    expect(result).not.toBe(request);

    const message = result.messages[0];
    if (message.role !== "user" || typeof message.content === "string") {
      throw new Error("expected multimodal user message");
    }
    const imagePart = message.content[1];
    if (imagePart.type !== "image") {
      throw new Error("expected image part");
    }
    const meta = await sharp(Buffer.from(imagePart.content, "base64")).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(7900);

    // 确定性：同输入再跑一遍，输出字节一致（Files API sha256 缓存跨轮稳定的前提）。
    const again = await clampRequestImages(request);
    const againMessage = again.messages[0];
    if (againMessage.role === "user" && typeof againMessage.content !== "string") {
      const againPart = againMessage.content[1];
      if (againPart.type === "image") {
        expect(againPart.content).toBe(imagePart.content);
      }
    }
  });

  it("解码失败的图片原样透传", async () => {
    const request = requestWithImage(Buffer.from("not an image").toString("base64"));
    const result = await clampRequestImages(request);
    expect(result).toBe(request);
  });

  it("纯文本请求原样返回", async () => {
    const request: LlmChatRequest = {
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      toolChoice: "none",
    };
    await expect(clampRequestImages(request)).resolves.toBe(request);
  });
});
