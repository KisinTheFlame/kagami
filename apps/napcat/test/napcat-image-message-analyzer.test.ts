import { describe, expect, it, vi } from "vitest";
import { DefaultNapcatImageMessageAnalyzer } from "../src/application/napcat-gateway/image-message-analyzer.js";
import { type VisionAgent } from "../src/vision/application/vision-agent.js";
import type { OssClient } from "../src/acl/oss-client.js";
import type { ImageAssetDao } from "../src/infra/image-asset.dao.js";
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

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/screen.png", {
      signal: expect.any(AbortSignal),
    });
    // 假字节解码失败 → 归一化 fail-open 原样透传成单元素 images。
    expect(visionAgent.analyzeImage).toHaveBeenCalledWith({
      images: [
        expect.objectContaining({
          content: Buffer.from("image"),
          mimeType: "image/png",
          filename: "screen.png",
        }),
      ],
    });
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

  it("should detect mime from bytes when header is missing (byte-sniff, not url extension)", async () => {
    const visionAgent = {
      analyzeImage: vi.fn().mockResolvedValue({
        description: "一只猫",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    } as unknown as VisionAgent;
    // 无 content-type 头、URL 也无扩展名，但字节是合法 JPEG（magic FF D8 FF）。
    const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      fetch: vi.fn().mockResolvedValue(new Response(jpegBytes, { status: 200 })),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/cat", "cat")),
    ).resolves.toEqual({ description: "一只猫", resid: null });

    expect(visionAgent.analyzeImage).toHaveBeenCalledWith({
      images: [expect.objectContaining({ mimeType: "image/jpeg" })],
    });
  });

  it("should trust bytes over a wrong header (text/html header + PNG magic → image/png)", async () => {
    const visionAgent = {
      analyzeImage: vi.fn().mockResolvedValue({ description: "一张图" }),
    } as unknown as VisionAgent;
    const ossClient: OssClient = {
      putObject: vi.fn().mockResolvedValue("res-8"),
      getObject: vi.fn(),
    };
    // 服务器谎报 text/html，但字节是合法 PNG（magic 89 50 4E 47 0D 0A 1A 0A），URL 无扩展名。
    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(8),
    ]);
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      ossClient,
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response(pngBytes, { status: 200, headers: { "content-type": "text/html" } }),
        ),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/mislabeled", "MD5P")),
    ).resolves.toEqual({ description: "一张图", resid: "res-8" });

    expect(ossClient.putObject).toHaveBeenCalledWith({
      bytes: pngBytes,
      mimeType: "image/png",
    });
  });

  it("should skip download when content-length exceeds the size cap", async () => {
    const visionAgent = { analyzeImage: vi.fn() } as unknown as VisionAgent;
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent,
      fetch: vi.fn().mockResolvedValue(
        new Response(Buffer.from("image"), {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(64 * 1024 * 1024) },
        }),
      ),
    });

    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/huge.png")),
    ).resolves.toEqual({ description: "", resid: null });
    expect(visionAgent.analyzeImage).not.toHaveBeenCalled();
  });

  it("should degrade to a failure placeholder when vision agent throws", async () => {
    const analyzer = new DefaultNapcatImageMessageAnalyzer({
      visionAgent: {
        analyzeImage: vi.fn().mockRejectedValue(new Error("vision failed")),
      } as unknown as VisionAgent,
      fetch: vi.fn().mockResolvedValue(imageResponse({ "content-type": "image/png" })),
    });

    // 占位而非空串：空描述会诱导主 Agent 去 read_resource 拉原图（#556 事故诱因环）。
    await expect(
      analyzer.analyzeImageSegment(createImageSegment("https://example.com/fail.png")),
    ).resolves.toEqual({ description: "[图片描述失败]", resid: null });
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
