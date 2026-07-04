import { describe, expect, it, vi } from "vitest";
import { ResourceService } from "../../../../src/agent/capabilities/resource/application/resource.service.js";
import type { OssClient } from "../../../../src/acl/oss-client.js";

function ossClientReturning(object: { bytes: Buffer; mimeType: string; size: number }): OssClient {
  return {
    putObject: vi.fn(),
    getObject: vi.fn().mockResolvedValue(object),
  };
}

describe("ResourceService", () => {
  it("classifies image MIME as image and carries bytes", async () => {
    const ossClient = ossClientReturning({
      bytes: Buffer.from("img"),
      mimeType: "image/png",
      size: 3,
    });
    const service = new ResourceService({ ossClient, maxBytes: 1000 });

    const resolved = await service.resolve("res-7");
    expect(resolved).toMatchObject({
      resId: "res-7",
      isImage: true,
      mimeType: "image/png",
      size: 3,
    });
    expect(resolved.bytes.toString()).toBe("img");
    expect(ossClient.getObject).toHaveBeenCalledWith("res-7", { maxBytes: 1000 });
  });

  it("classifies non-image MIME as not image", async () => {
    const service = new ResourceService({
      ossClient: ossClientReturning({
        bytes: Buffer.from("%PDF"),
        mimeType: "application/pdf",
        size: 4,
      }),
      maxBytes: 1000,
    });

    const resolved = await service.resolve("res-9");
    expect(resolved.isImage).toBe(false);
  });

  it("rejects an id that is not res-<digits>", async () => {
    const service = new ResourceService({
      ossClient: ossClientReturning({ bytes: Buffer.alloc(0), mimeType: "image/png", size: 0 }),
      maxBytes: 1000,
    });

    await expect(service.resolve("not-a-resid")).rejects.toMatchObject({
      meta: { reason: "INVALID_RESOURCE_ID" },
    });
  });

  it("throws RESOURCE_OSS_DISABLED when OSS is not configured", async () => {
    const service = new ResourceService({ ossClient: undefined, maxBytes: 1000 });

    await expect(service.resolve("res-1")).rejects.toMatchObject({
      meta: { reason: "RESOURCE_OSS_DISABLED" },
    });
  });

  it("bubbles up OSS errors (e.g. not found / too large)", async () => {
    const ossClient: OssClient = {
      putObject: vi.fn(),
      getObject: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("not found"), { meta: { reason: "OSS_OBJECT_NOT_FOUND" } }),
        ),
    };
    const service = new ResourceService({ ossClient, maxBytes: 1000 });

    await expect(service.resolve("res-404")).rejects.toMatchObject({
      meta: { reason: "OSS_OBJECT_NOT_FOUND" },
    });
  });
});
