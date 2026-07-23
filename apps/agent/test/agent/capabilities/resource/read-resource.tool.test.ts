import { describe, expect, it, vi } from "vitest";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { ReadResourceTool } from "../../../../src/agent/capabilities/resource/tools/read-resource.tool.js";
import type { ResourceService } from "../../../../src/agent/capabilities/resource/application/resource.service.js";
import type { AppendMessageEffect } from "../../../../src/agent/runtime/effect/root-agent-effect.js";

function toolWith(resolve: ResourceService["resolve"]): ReadResourceTool {
  return new ReadResourceTool({ resourceService: { resolve } as unknown as ResourceService });
}

describe("ReadResourceTool", () => {
  it("appends the original image to context for an image resource", async () => {
    const tool = toolWith(
      vi.fn().mockResolvedValue({
        resId: "res-7",
        bytes: Buffer.from("imgbytes"),
        mimeType: "image/jpeg",
        size: 8,
        isImage: true,
      }),
    );

    const result = await tool.execute({ resid: "res-7" }, {});
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      resid: "res-7",
      mime: "image/jpeg",
    });
    expect(result.effects).toHaveLength(1);
    const effect = result.effects?.[0] as AppendMessageEffect;
    expect(effect.type).toBe("append_message");
    // 假字节解码失败 → 归一化 fail-open 原样透传成单元素 images。
    expect(effect.images).toHaveLength(1);
    expect(effect.images?.[0]?.mimeType).toBe("image/jpeg");
    expect(effect.images?.[0]?.content).toBe(Buffer.from("imgbytes").toString("base64"));
  });

  it("slices an extreme long image into ordered tiles in one message", async () => {
    const sharp = (await import("sharp")).default;
    const longImage = await sharp({
      create: { width: 300, height: 8100, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toBuffer();
    const tool = toolWith(
      vi.fn().mockResolvedValue({
        resId: "res-11",
        bytes: longImage,
        mimeType: "image/jpeg",
        size: longImage.byteLength,
        isImage: true,
      }),
    );

    const result = await tool.execute({ resid: "res-11" }, {});
    const effect = result.effects?.[0] as AppendMessageEffect;
    expect(effect.images?.length).toBeGreaterThan(1);
    expect(effect.content).toContain(`tiles="${effect.images?.length}"`);
    expect(effect.images?.[0]?.filename).toBe(`res-11-part-1of${effect.images?.length}`);
  });

  it("returns metadata only (no image effect) for a non-image resource", async () => {
    const tool = toolWith(
      vi.fn().mockResolvedValue({
        resId: "res-9",
        bytes: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        size: 4,
        isImage: false,
      }),
    );

    const result = await tool.execute({ resid: "res-9" }, {});
    expect(result.effects).toBeUndefined();
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      kind: "non_image",
      mime: "application/pdf",
    });
  });

  it("returns a self-contained error and no effect when resolve fails", async () => {
    const tool = toolWith(
      vi.fn().mockRejectedValue(
        new BizError({
          message: "OSS 对象不存在：res-404",
          meta: { reason: "OSS_OBJECT_NOT_FOUND" },
        }),
      ),
    );

    const result = await tool.execute({ resid: "res-404" }, {});
    expect(result.effects).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed).toMatchObject({ ok: false, resid: "res-404", error: "OSS_OBJECT_NOT_FOUND" });
    expect(parsed.note).toContain("res-404");
  });
});
