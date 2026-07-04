import { describe, expect, it, vi } from "vitest";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";
import { BrowserScreenshotTool } from "../../../../src/agent/capabilities/browser/tools/screenshot.tool.js";

// 截图降级路径会 logger.warn，需要先初始化日志 runtime（否则 getLoggerRuntime 抛）。
initTestLoggerRuntime();
import type { BrowserClient } from "../../../../src/acl/browser-client.js";
import type { OssClient } from "../../../../src/acl/oss-client.js";
import type { AppendMessageEffect } from "../../../../src/agent/runtime/effect/root-agent-effect.js";

function fakeBrowserClient(): BrowserClient {
  return {
    screenshot: vi.fn().mockResolvedValue({
      image: Buffer.from("shot"),
      mimeType: "image/jpeg",
      width: 1024,
      height: 768,
      url: "https://example.com",
    }),
  } as unknown as BrowserClient;
}

function buildTool(ossClient?: OssClient): BrowserScreenshotTool {
  const service = fakeBrowserClient();
  return new BrowserScreenshotTool({ getBrowserClient: () => service, ossClient });
}

describe("BrowserScreenshotTool", () => {
  it("archives to OSS and returns the resid, still appending the image", async () => {
    const ossClient: OssClient = {
      putObject: vi.fn().mockResolvedValue("res-7"),
      getObject: vi.fn(),
    };
    const result = await buildTool(ossClient).execute({}, {});

    expect(ossClient.putObject).toHaveBeenCalledWith({
      bytes: Buffer.from("shot"),
      mimeType: "image/jpeg",
    });
    expect(JSON.parse(result.content)).toMatchObject({ ok: true, resid: "res-7" });
    const effect = result.effects?.[0] as AppendMessageEffect;
    expect(effect.image?.content).toBe(Buffer.from("shot").toString("base64"));
    expect(effect.content).toContain('resid="res-7"');
  });

  it("degrades gracefully when the OSS PUT fails (image still enters context)", async () => {
    const ossClient: OssClient = {
      putObject: vi.fn().mockRejectedValue(new Error("oss down")),
      getObject: vi.fn(),
    };
    const result = await buildTool(ossClient).execute({}, {});

    const parsed = JSON.parse(result.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.resid).toBeUndefined();
    expect(result.effects).toHaveLength(1);
  });

  it("works with no OSS client (no resid, image still appended)", async () => {
    const result = await buildTool(undefined).execute({}, {});

    const parsed = JSON.parse(result.content);
    expect(parsed.resid).toBeUndefined();
    const effect = result.effects?.[0] as AppendMessageEffect;
    expect(effect.image?.mimeType).toBe("image/jpeg");
    expect(effect.content).not.toContain("resid=");
  });
});
