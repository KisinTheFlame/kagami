import { describe, expect, it, vi } from "vitest";
import { DefaultNapcatImageMessageAnalyzer } from "../../src/service/napcat-gateway/image-message-analyzer.js";
import type { VisionAgent } from "../../src/agents/subagents/vision/index.js";
import { initTestLogger } from "./napcat-gateway.test-helper.js";

function createImageSegment(url: string, file = "image.png") {
  return {
    type: "image" as const,
    data: {
      summary: "图片",
      file,
      sub_type: 0,
      url,
      file_size: "123",
    },
  };
}

describe("DefaultNapcatImageMessageAnalyzer", () => {
  initTestLogger();

  it("should download image and analyze it with vision agent", async () => {
    const visionAgent = {
      analyzeImage: vi.fn().mockResolvedValue({
        description: "屏幕截图里有一个登录表单",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    } as unknown as VisionAgent;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("image"), {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      }),
    );
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      fetch: fetchMock,
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/screen.png")),
    ).resolves.toBe("[图片: 屏幕截图里有一个登录表单]");

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/screen.png");
    expect(visionAgent.analyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: Buffer.from("image"),
        mimeType: "image/png",
        filename: "screen.png",
      }),
    );
  });

  it("should fallback when response content-type is not image", async () => {
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent: {
        analyzeImage: vi.fn(),
      } as unknown as VisionAgent,
      fetch: vi.fn().mockResolvedValue(
        new Response(Buffer.from("html"), {
          status: 200,
          headers: {
            "content-type": "text/html",
          },
        }),
      ),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/not-image")),
    ).resolves.toBe("[图片]");
  });

  it("should infer mime type from url when header is missing", async () => {
    const visionAgent = {
      analyzeImage: vi.fn().mockResolvedValue({
        description: "一只猫",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    } as unknown as VisionAgent;
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      fetch: vi.fn().mockResolvedValue(
        new Response(Buffer.from("image"), {
          status: 200,
        }),
      ),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/cat.jpeg", "cat.jpeg")),
    ).resolves.toBe("[图片: 一只猫]");

    expect(visionAgent.analyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "image/jpeg",
      }),
    );
  });

  it("should fallback when vision agent throws", async () => {
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent: {
        analyzeImage: vi.fn().mockRejectedValue(new Error("vision failed")),
      } as unknown as VisionAgent,
      fetch: vi.fn().mockResolvedValue(
        new Response(Buffer.from("image"), {
          status: 200,
          headers: {
            "content-type": "image/png",
          },
        }),
      ),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/fail.png")),
    ).resolves.toBe("[图片]");
  });

  it("should sanitize verbose vision output into a single short message", async () => {
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent: {
        analyzeImage: vi.fn().mockResolvedValue({
          description:
            "## 1. 主体\n- 一名女生坐在桌前看向镜头\n## 2. 界面\n- 这是短视频应用截图\n如果你愿意，我还可以进一步整理成 alt 文本",
          provider: "openai",
          model: "gpt-4o-mini",
        }),
      } as unknown as VisionAgent,
      fetch: vi.fn().mockResolvedValue(
        new Response(Buffer.from("image"), {
          status: 200,
          headers: {
            "content-type": "image/png",
          },
        }),
      ),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/verbose.png")),
    ).resolves.toBe("[图片: 主体；一名女生坐在桌前看向镜头；界面；这是短视频应用截图]");
  });
});
