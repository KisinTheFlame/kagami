import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceFileService } from "../../src/agent/capabilities/resource/application/resource-file.service.js";
import type { OssClient } from "../../src/acl/oss-client.js";

function ossStub(overrides: Partial<OssClient> = {}): OssClient {
  return {
    putObject: vi.fn().mockResolvedValue("res-1"),
    getObject: vi.fn().mockResolvedValue({
      bytes: Buffer.from("hello"),
      mimeType: "text/plain",
      size: 5,
    }),
    ...overrides,
  };
}

describe("ResourceFileService", () => {
  let root: string;

  beforeEach(async () => {
    // realpath 规范化：macOS 的 /var 是 /private/var 的 symlink，服务内部会 realpath，
    // 断言的 root 也要 realpath 才能对齐。
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kagami-filesvc-")));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const FILE_MAX = 1024 * 1024;

  it("downloadToFile 落地 OSS 字节并原子写入，按 fileMaxBytes 取 getObject", async () => {
    const ossClient = ossStub();
    const service = new ResourceFileService({ ossClient, fileRoot: root, fileMaxBytes: FILE_MAX });

    const result = await service.downloadToFile({ resId: "res-7", filename: "a.txt" });

    expect(result.absolutePath).toBe(path.join(root, "a.txt"));
    expect(result.size).toBe(5);
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("hello");
    expect(ossClient.getObject).toHaveBeenCalledWith("res-7", { maxBytes: FILE_MAX });
  });

  it("downloadToFile 支持 dir 子目录并 mkdir", async () => {
    const service = new ResourceFileService({
      ossClient: ossStub(),
      fileRoot: root,
      fileMaxBytes: FILE_MAX,
    });

    const result = await service.downloadToFile({ resId: "res-1", dir: "docs", filename: "b.txt" });

    expect(result.absolutePath).toBe(path.join(root, "docs", "b.txt"));
    expect(await readFile(path.join(root, "docs", "b.txt"), "utf8")).toBe("hello");
  });

  it("downloadToFile 目标已存在 → FILE_EXISTS，不覆盖", async () => {
    await writeFile(path.join(root, "a.txt"), "old");
    const ossClient = ossStub();
    const service = new ResourceFileService({ ossClient, fileRoot: root, fileMaxBytes: FILE_MAX });

    await expect(
      service.downloadToFile({ resId: "res-1", filename: "a.txt" }),
    ).rejects.toMatchObject({ meta: { reason: "FILE_EXISTS" } });
    expect(ossClient.getObject).not.toHaveBeenCalled();
    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("old");
  });

  it("downloadToFile OSS 关闭 → RESOURCE_OSS_DISABLED", async () => {
    const service = new ResourceFileService({ fileRoot: root, fileMaxBytes: FILE_MAX });
    await expect(
      service.downloadToFile({ resId: "res-1", filename: "a.txt" }),
    ).rejects.toMatchObject({ meta: { reason: "RESOURCE_OSS_DISABLED" } });
  });

  it("uploadFromFile 读盘 + detectMime + putObject，返回新 res", async () => {
    // 合法 PNG magic，detectMime 应识别成 image/png。
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(8),
    ]);
    await writeFile(path.join(root, "pic.png"), png);
    const ossClient = ossStub({ putObject: vi.fn().mockResolvedValue("res-9") });
    const service = new ResourceFileService({ ossClient, fileRoot: root, fileMaxBytes: FILE_MAX });

    const result = await service.uploadFromFile({ path: "pic.png" });

    expect(result).toEqual({ resId: "res-9", mimeType: "image/png", size: png.byteLength });
    expect(ossClient.putObject).toHaveBeenCalledWith({ bytes: png, mimeType: "image/png" });
  });

  it("uploadFromFile 超 fileMaxBytes → FILE_TOO_LARGE", async () => {
    await writeFile(path.join(root, "big.bin"), Buffer.alloc(2048));
    const service = new ResourceFileService({
      ossClient: ossStub(),
      fileRoot: root,
      fileMaxBytes: 1024,
    });

    await expect(service.uploadFromFile({ path: "big.bin" })).rejects.toMatchObject({
      meta: { reason: "FILE_TOO_LARGE" },
    });
  });

  it("uploadFromFile OSS 关闭时不读盘、直接 RESOURCE_OSS_DISABLED", async () => {
    const service = new ResourceFileService({ fileRoot: root, fileMaxBytes: FILE_MAX });

    // 路径指向不存在的文件：若先读盘会得 FILE_NOT_FOUND；实际得 RESOURCE_OSS_DISABLED，
    // 证明 OSS 检查发生在任何磁盘访问之前。
    await expect(service.uploadFromFile({ path: "does-not-exist.txt" })).rejects.toMatchObject({
      meta: { reason: "RESOURCE_OSS_DISABLED" },
    });
  });

  it("resolveWithinRoot 挡 ../ 逃逸 → PATH_ESCAPE", async () => {
    const service = new ResourceFileService({
      ossClient: ossStub(),
      fileRoot: root,
      fileMaxBytes: FILE_MAX,
    });
    await expect(service.uploadFromFile({ path: "../escape.txt" })).rejects.toMatchObject({
      meta: { reason: "PATH_ESCAPE" },
    });
  });

  it("resolveWithinRoot 挡绝对路径逃逸 → PATH_ESCAPE", async () => {
    const service = new ResourceFileService({
      ossClient: ossStub(),
      fileRoot: root,
      fileMaxBytes: FILE_MAX,
    });
    await expect(
      service.downloadToFile({ resId: "res-1", filename: "/etc/passwd-copy" }),
    ).rejects.toMatchObject({ meta: { reason: "PATH_ESCAPE" } });
  });

  it("resolveWithinRoot 挡 root 内 symlink 指向外 → PATH_ESCAPE", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "kagami-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "top secret");
    // 在 root 内建一个指向 root 外目录的 symlink，试图借它读根外文件。
    await symlink(outside, path.join(root, "link"));
    const service = new ResourceFileService({
      ossClient: ossStub(),
      fileRoot: root,
      fileMaxBytes: FILE_MAX,
    });

    await expect(service.uploadFromFile({ path: "link/secret.txt" })).rejects.toMatchObject({
      meta: { reason: "PATH_ESCAPE" },
    });
    await rm(outside, { recursive: true, force: true });
  });
});
