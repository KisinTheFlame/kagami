import { describe, expect, it, vi } from "vitest";
import { DefaultNapcatImageMessageAnalyzer } from "../../src/napcat/application/napcat-gateway/image-message-analyzer.js";
import { type VisionAgent } from "../../src/agent/capabilities/vision/application/vision-agent.js";
import type { OssClient } from "../../src/oss/oss-client.js";
import type { ImageAssetDao } from "../../src/napcat/infra/image-asset.dao.js";
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

function imageResponse(headers?: Record<string, string>): Response {
  return new Response(Buffer.from("image"), { status: 200, headers });
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
    const fetchMock = vi.fn().mockResolvedValue(imageResponse({ "content-type": "image/png" }));
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      fetch: fetchMock,
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/screen.png")),
    ).resolves.toEqual({ description: "屏幕截图里有一个登录表单", resid: null });

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/screen.png");
    expect(visionAgent.analyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: Buffer.from("image"),
        mimeType: "image/png",
        filename: "screen.png",
      }),
    );
  });

  it("should return empty description when response content-type is not image", async () => {
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent: {
        analyzeImage: vi.fn(),
      } as unknown as VisionAgent,
      fetch: vi.fn().mockResolvedValue(
        new Response(Buffer.from("html"), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/not-image")),
    ).resolves.toEqual({ description: "", resid: null });
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
      fetch: vi.fn().mockResolvedValue(new Response(Buffer.from("image"), { status: 200 })),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/cat.jpeg", "cat.jpeg")),
    ).resolves.toEqual({ description: "一只猫", resid: null });

    expect(visionAgent.analyzeImage).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/jpeg" }),
    );
  });

  it("should return empty description when vision agent throws", async () => {
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent: {
        analyzeImage: vi.fn().mockRejectedValue(new Error("vision failed")),
      } as unknown as VisionAgent,
      fetch: vi.fn().mockResolvedValue(imageResponse({ "content-type": "image/png" })),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/fail.png")),
    ).resolves.toEqual({ description: "", resid: null });
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
      fetch: vi.fn().mockResolvedValue(imageResponse({ "content-type": "image/png" })),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/verbose.png")),
    ).resolves.toEqual({
      description: "主体；一名女生坐在桌前看向镜头；界面；这是短视频应用截图",
      resid: null,
    });
  });

  it("should archive the image to OSS and cache the resid + description", async () => {
    const visionAgent = {
      analyzeImage: vi.fn().mockResolvedValue({ description: "一张架构图" }),
    } as unknown as VisionAgent;
    const ossClient: OssClient = {
      putObject: vi.fn().mockResolvedValue("res-7"),
      getObject: vi.fn(),
    };
    const imageAssetDao: ImageAssetDao = {
      findByFileId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      ossClient,
      imageAssetDao,
      fetch: vi.fn().mockResolvedValue(imageResponse({ "content-type": "image/png" })),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/a.png", "MD5A.png")),
    ).resolves.toEqual({ description: "一张架构图", resid: "res-7" });

    expect(ossClient.putObject).toHaveBeenCalledWith({
      bytes: Buffer.from("image"),
      mimeType: "image/png",
    });
    expect(imageAssetDao.upsert).toHaveBeenCalledWith({
      fileId: "MD5A.png",
      resid: "res-7",
      description: "一张架构图",
      mime: "image/png",
    });
  });

  it("should reuse a cached asset, skipping download and vision", async () => {
    const visionAgent = { analyzeImage: vi.fn() } as unknown as VisionAgent;
    const fetchMock = vi.fn();
    const imageAssetDao: ImageAssetDao = {
      findByFileId: vi.fn().mockResolvedValue({ resid: "res-1", description: "缓存的描述" }),
      upsert: vi.fn(),
    };
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      ossClient: { putObject: vi.fn(), getObject: vi.fn() },
      imageAssetDao,
      fetch: fetchMock,
    });

    await expect(
      analyzer.analyzeImageSegment(
        createImageSegment("https://example.com/cached.png", "MD5C.png"),
      ),
    ).resolves.toEqual({ description: "缓存的描述", resid: "res-1" });

    expect(imageAssetDao.findByFileId).toHaveBeenCalledWith("MD5C.png");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(visionAgent.analyzeImage).not.toHaveBeenCalled();
  });

  it("should return null resid and not cache when OSS archive fails", async () => {
    const visionAgent = {
      analyzeImage: vi.fn().mockResolvedValue({ description: "一张图" }),
    } as unknown as VisionAgent;
    const imageAssetDao: ImageAssetDao = {
      findByFileId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    };
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      ossClient: {
        putObject: vi.fn().mockRejectedValue(new Error("oss down")),
        getObject: vi.fn(),
      },
      imageAssetDao,
      fetch: vi.fn().mockResolvedValue(imageResponse({ "content-type": "image/png" })),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/x.png", "MD5X.png")),
    ).resolves.toEqual({ description: "一张图", resid: null });

    expect(imageAssetDao.upsert).not.toHaveBeenCalled();
  });
});
