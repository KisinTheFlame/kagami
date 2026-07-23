import { describe, expect, it, vi } from "vitest";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { DownloadResourceTool } from "../../src/agent/capabilities/resource/tools/download-resource.tool.js";
import { UploadResourceTool } from "../../src/agent/capabilities/resource/tools/upload-resource.tool.js";
import type { ResourceFileService } from "../../src/agent/capabilities/resource/application/resource-file.service.js";

function parse(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

describe("download_resource / upload_resource tools", () => {
  it("download_resource 成功回 path（resid/size 不进上下文）", async () => {
    const resourceFileService = {
      downloadToFile: vi.fn().mockResolvedValue({ absolutePath: "/home/k/kagami/a.txt", size: 5 }),
      uploadFromFile: vi.fn(),
    } as unknown as ResourceFileService;
    const tool = new DownloadResourceTool({ resourceFileService });

    const result = await tool.execute({ resid: "res-7", filename: "a.txt" }, {});
    const body = parse(result.content);

    expect(body).toMatchObject({ ok: true, path: "/home/k/kagami/a.txt" });
    expect(body.resid).toBeUndefined();
    expect(body.size).toBeUndefined();
    expect(resourceFileService.downloadToFile).toHaveBeenCalledWith({
      resId: "res-7",
      dir: undefined,
      filename: "a.txt",
    });
  });

  it("download_resource 失败把 BizError.reason 映射进自包含错误文案", async () => {
    const resourceFileService = {
      downloadToFile: vi
        .fn()
        .mockRejectedValue(new BizError({ message: "已存在", meta: { reason: "FILE_EXISTS" } })),
      uploadFromFile: vi.fn(),
    } as unknown as ResourceFileService;
    const tool = new DownloadResourceTool({ resourceFileService });

    const body = parse((await tool.execute({ resid: "res-1", filename: "a.txt" }, {})).content);

    expect(body).toMatchObject({ ok: false, error: "FILE_EXISTS" });
  });

  it("upload_resource 成功回 resid（mime/size 不进上下文）", async () => {
    const resourceFileService = {
      downloadToFile: vi.fn(),
      uploadFromFile: vi
        .fn()
        .mockResolvedValue({ resId: "res-9", mimeType: "application/pdf", size: 123 }),
    } as unknown as ResourceFileService;
    const tool = new UploadResourceTool({ resourceFileService });

    const body = parse((await tool.execute({ path: "docs/x.pdf" }, {})).content);

    expect(body).toEqual({ ok: true, resid: "res-9" });
    expect(resourceFileService.uploadFromFile).toHaveBeenCalledWith({ path: "docs/x.pdf" });
  });
});
