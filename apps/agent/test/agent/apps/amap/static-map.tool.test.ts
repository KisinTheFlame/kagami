import { describe, expect, it, vi } from "vitest";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";
import { StaticMapTool } from "../../../../src/agent/apps/amap/tools/static-map.tool.js";

// OSS 降级路径会 logger.warn，需要先初始化日志 runtime（否则 getLoggerRuntime 抛）。
initTestLoggerRuntime();
import type { AmapClient } from "../../../../src/agent/apps/amap/client/amap-client.js";
import type { OssClient } from "../../../../src/acl/oss-client.js";
import type { AppendMessageEffect } from "../../../../src/agent/runtime/effect/root-agent-effect.js";

function fakeClient(): AmapClient {
  return {
    staticMap: vi.fn().mockResolvedValue({ bytes: Buffer.from("MAP"), mimeType: "image/png" }),
  } as unknown as AmapClient;
}

function buildTool(ossClient?: OssClient): StaticMapTool {
  return new StaticMapTool({
    getClient: () => fakeClient(),
    getDefaultSize: () => "600*400",
    getScale: () => 2,
    ossClient,
  });
}

describe("StaticMapTool", () => {
  it("archives to OSS and returns resid, still appending the image", async () => {
    const ossClient: OssClient = {
      putObject: vi.fn().mockResolvedValue("res-9"),
      getObject: vi.fn(),
    };
    const result = await buildTool(ossClient).execute({ location: "116.39,39.90" }, {});
    expect(ossClient.putObject).toHaveBeenCalledWith({
      bytes: Buffer.from("MAP"),
      mimeType: "image/png",
    });
    expect(JSON.parse(result.content)).toMatchObject({ ok: true, resid: "res-9" });
    const effect = result.effects?.[0] as AppendMessageEffect;
    expect(effect.images?.[0]?.content).toBe(Buffer.from("MAP").toString("base64"));
    expect(effect.content).toContain('resid="res-9"');
  });

  it("degrades gracefully when OSS PUT fails (image still enters context)", async () => {
    const ossClient: OssClient = {
      putObject: vi.fn().mockRejectedValue(new Error("oss down")),
      getObject: vi.fn(),
    };
    const result = await buildTool(ossClient).execute({ location: "116.39,39.90" }, {});
    const parsed = JSON.parse(result.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.resid).toBeUndefined();
    const effect = result.effects?.[0] as AppendMessageEffect;
    expect(effect.images?.[0]?.content).toBe(Buffer.from("MAP").toString("base64"));
  });

  it("works with no OSS configured (no resid, image still appended)", async () => {
    const result = await buildTool(undefined).execute({ location: "116.39,39.90" }, {});
    const parsed = JSON.parse(result.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.resid).toBeUndefined();
    expect((result.effects?.[0] as AppendMessageEffect).images?.[0]).toBeDefined();
  });

  it("rejects an empty call (no location, no markers, no paths)", async () => {
    const result = await buildTool(undefined).execute({}, {});
    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });

  it("rejects an oversized size (validation)", async () => {
    const result = await buildTool(undefined).execute(
      { location: "116.39,39.90", size: "2000*2000" },
      {},
    );
    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });
});
