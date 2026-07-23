import { describe, expect, it, vi, type Mock } from "vitest";
import { ListGroupFilesTool } from "../../../../src/agent/apps/qq/tools/list-group-files.tool.js";
import { DownloadGroupFileTool } from "../../../../src/agent/apps/qq/tools/download-group-file.tool.js";
import { UploadGroupFileTool } from "../../../../src/agent/apps/qq/tools/upload-group-file.tool.js";
import type { NapcatChatTarget } from "@kagami/napcat-api/message";
import type { NapcatClient } from "../../../../src/acl/napcat-client.js";
import type { OssClient } from "../../../../src/acl/oss-client.js";
import { initTestLogger } from "../../../helpers/logger.js";

const GROUP: NapcatChatTarget = { chatType: "group", groupId: "1" };
const PRIVATE: NapcatChatTarget = { chatType: "private", userId: "5" };

function parse(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

type GatewayStub = NapcatClient & {
  listGroupFiles: Mock;
  getGroupFileUrl: Mock;
  uploadGroupFile: Mock;
};

function gatewayStub(overrides: Record<string, unknown> = {}): GatewayStub {
  return {
    listGroupFiles: vi.fn(),
    getGroupFileUrl: vi.fn(),
    uploadGroupFile: vi.fn(),
    ...overrides,
  } as unknown as GatewayStub;
}

function ossStub(overrides: Partial<OssClient> = {}): OssClient {
  return { putObject: vi.fn(), getObject: vi.fn(), ...overrides };
}

describe("QQ group file tools", () => {
  initTestLogger();

  it("list_group_files 私聊会话 → NOT_IN_GROUP_CHAT（群限定守卫）", async () => {
    const tool = new ListGroupFilesTool({
      getChatTarget: () => PRIVATE,
      napcatGateway: gatewayStub(),
    });
    const body = parse((await tool.execute({}, {})).content);
    expect(body).toMatchObject({ ok: false, error: "NOT_IN_GROUP_CHAT" });
  });

  it("list_group_files 群会话 → 渲染文件与文件夹", async () => {
    const napcatGateway = gatewayStub({
      listGroupFiles: vi.fn().mockResolvedValue({
        files: [
          { fileId: "f1", fileName: "a.pdf", size: 2048, uploadTime: 1, uploaderName: "阿三" },
        ],
        folders: [{ folderId: "d1", folderName: "资料", fileCount: 3 }],
      }),
    });
    const tool = new ListGroupFilesTool({ getChatTarget: () => GROUP, napcatGateway });

    const body = parse((await tool.execute({}, {})).content);
    expect(body).toMatchObject({
      ok: true,
      files: [{ file_id: "f1", name: "a.pdf", size: 2048 }],
      folders: [{ folder_id: "d1", name: "资料", file_count: 3 }],
    });
    expect(napcatGateway.listGroupFiles).toHaveBeenCalledWith({
      groupId: "1",
      folderId: undefined,
      fileCount: 100,
    });
  });

  it("download_group_file 全链：url→fetch→OSS res（非图落 octet-stream）", async () => {
    const napcatGateway = gatewayStub({
      getGroupFileUrl: vi.fn().mockResolvedValue({ url: "https://cdn.qq.com/f1" }),
    });
    const ossClient = ossStub({ putObject: vi.fn().mockResolvedValue("res-3") });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(Buffer.from("%PDF-1.7 data"), { status: 200 }));
    const tool = new DownloadGroupFileTool({
      getChatTarget: () => GROUP,
      napcatGateway,
      ossClient,
      fileMaxBytes: 1024 * 1024,
      fetch: fetchMock,
    });

    const body = parse((await tool.execute({ file_id: "f1" }, {})).content);
    expect(body).toMatchObject({ ok: true, resid: "res-3" });
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.qq.com/f1");
    expect(ossClient.putObject).toHaveBeenCalledWith({
      bytes: Buffer.from("%PDF-1.7 data"),
      mimeType: "application/octet-stream",
    });
  });

  it("download_group_file OSS 关闭 → RESOURCE_OSS_DISABLED", async () => {
    const tool = new DownloadGroupFileTool({
      getChatTarget: () => GROUP,
      napcatGateway: gatewayStub({ getGroupFileUrl: vi.fn() }),
      fileMaxBytes: 1024,
    });
    const body = parse((await tool.execute({ file_id: "f1" }, {})).content);
    expect(body).toMatchObject({ ok: false, error: "RESOURCE_OSS_DISABLED" });
  });

  it("download_group_file 超 content-length cap → FILE_TOO_LARGE", async () => {
    const napcatGateway = gatewayStub({
      getGroupFileUrl: vi.fn().mockResolvedValue({ url: "https://cdn.qq.com/huge" }),
    });
    const ossClient = ossStub();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("x"), {
        status: 200,
        headers: { "content-length": String(64 * 1024 * 1024) },
      }),
    );
    const tool = new DownloadGroupFileTool({
      getChatTarget: () => GROUP,
      napcatGateway,
      ossClient,
      fileMaxBytes: 32 * 1024 * 1024,
      fetch: fetchMock,
    });

    const body = parse((await tool.execute({ file_id: "huge" }, {})).content);
    expect(body).toMatchObject({ ok: false, error: "FILE_TOO_LARGE" });
    expect(ossClient.putObject).not.toHaveBeenCalled();
  });

  it("upload_group_file：OSS 字节 → base64:// 自包含 → uploadGroupFile", async () => {
    const napcatGateway = gatewayStub({ uploadGroupFile: vi.fn().mockResolvedValue(undefined) });
    const ossClient = ossStub({
      getObject: vi.fn().mockResolvedValue({
        bytes: Buffer.from("ABC"),
        mimeType: "application/pdf",
        size: 3,
      }),
    });
    const tool = new UploadGroupFileTool({
      getChatTarget: () => GROUP,
      napcatGateway,
      ossClient,
      fileMaxBytes: 32 * 1024 * 1024,
    });

    const body = parse((await tool.execute({ resid: "res-5", name: "x.pdf" }, {})).content);
    expect(body).toEqual({ ok: true });
    expect(ossClient.getObject).toHaveBeenCalledWith("res-5", { maxBytes: 32 * 1024 * 1024 });
    expect(napcatGateway.uploadGroupFile).toHaveBeenCalledWith({
      groupId: "1",
      fileRef: `base64://${Buffer.from("ABC").toString("base64")}`,
      name: "x.pdf",
      folderId: undefined,
    });
  });

  it("upload_group_file resid 不存在 → RESOURCE_NOT_FOUND", async () => {
    const ossClient = ossStub({
      getObject: vi.fn().mockRejectedValue(new Error("not found")),
    });
    const tool = new UploadGroupFileTool({
      getChatTarget: () => GROUP,
      napcatGateway: gatewayStub(),
      ossClient,
      fileMaxBytes: 1024,
    });
    const body = parse((await tool.execute({ resid: "res-x", name: "x.pdf" }, {})).content);
    expect(body).toMatchObject({ ok: false, error: "RESOURCE_NOT_FOUND" });
  });
});
