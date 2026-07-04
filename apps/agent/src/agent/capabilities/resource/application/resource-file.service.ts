import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BizError } from "@kagami/kernel/errors/biz-error";
import { detectMime } from "../../../../common/detect-mime.js";
import type { OssClient } from "../../../../acl/oss-client.js";

/** download_resource 的结果：落地的绝对路径 + 写入字节数。 */
export type DownloadToFileResult = { absolutePath: string; size: number };
/** upload_resource 的结果：新 res（对外 key 自增）+ 探测出的 mime + 字节数。 */
export type UploadFromFileResult = { resId: string; mimeType: string; size: number };

/**
 * 资源与本地文件之间的桥：download_resource（OSS res → 本地文件）与 upload_resource
 * （本地文件 → OSS res）共用。一切落盘 / 读盘都锚定在 `fileRoot` 沙箱内（默认 ~/kagami，
 * 与 terminal initialCwd 重合，落盘后 terminal ls 天然可见）。
 *
 * 安全边界：
 * - 路径逃逸：resolveWithinRoot 先 realpath 根、再 realpath 目标的「最深已存在祖先」，
 *   把根内 symlink 指向根外的情况也挡掉（纯前缀字符串校验挡不住 symlink）。
 * - 大小护栏：`fileMaxBytes`（默认 32 MiB，独立于 4 MiB 上下文 cap）。上传 stat 早拒，
 *   下载靠 OSS getObject 的 maxBytes 早拒（content-length + 实际字节双重）。
 * - OSS 关闭：任何操作在触碰磁盘前先失败（RESOURCE_OSS_DISABLED），OSS 关时绝不读盘。
 * - 覆盖策略：下载目标已存在直接拒（FILE_EXISTS，不覆盖），并用 .part → rename 原子落地。
 */
export class ResourceFileService {
  private readonly ossClient: OssClient | undefined;
  private readonly fileRoot: string;
  private readonly fileMaxBytes: number;

  public constructor({
    ossClient,
    fileRoot,
    fileMaxBytes,
  }: {
    ossClient?: OssClient;
    fileRoot: string;
    fileMaxBytes: number;
  }) {
    this.ossClient = ossClient;
    this.fileRoot = expandHome(fileRoot);
    this.fileMaxBytes = fileMaxBytes;
  }

  /** OSS res → 本地文件。文件名由调用方给出（不沿用 res 的内容寻址名）。 */
  public async downloadToFile({
    resId,
    dir,
    filename,
  }: {
    resId: string;
    dir?: string;
    filename: string;
  }): Promise<DownloadToFileResult> {
    const ossClient = this.requireOss();
    const target = await this.resolveWithinRoot(path.join(dir ?? "", filename));
    if (existsSync(target)) {
      throw new BizError({
        message: `目标文件已存在，换个文件名或目录：${target}`,
        meta: { reason: "FILE_EXISTS", target },
      });
    }

    const object = await ossClient.getObject(resId, { maxBytes: this.fileMaxBytes });
    await mkdir(path.dirname(target), { recursive: true });
    // .part → rename 原子落地：崩溃时不留半截文件占用最终名。
    const tmp = `${target}.part`;
    await writeFile(tmp, object.bytes);
    await rename(tmp, target);
    return { absolutePath: target, size: object.size };
  }

  /** 本地文件 → OSS res。复用 OSS 内部 sha256 去重 + refcount；对外 res key 每次自增。 */
  public async uploadFromFile({
    path: sourcePath,
  }: {
    path: string;
  }): Promise<UploadFromFileResult> {
    // OSS 关时在触碰磁盘前失败——不做无意义的读盘。
    const ossClient = this.requireOss();
    const source = await this.resolveWithinRoot(sourcePath);
    let stats;
    try {
      stats = await stat(source);
    } catch {
      throw new BizError({
        message: `本地文件不存在：${source}`,
        meta: { reason: "FILE_NOT_FOUND", source },
      });
    }
    if (!stats.isFile()) {
      throw new BizError({
        message: `路径不是普通文件：${source}`,
        meta: { reason: "FILE_NOT_FOUND", source },
      });
    }
    if (stats.size > this.fileMaxBytes) {
      throw new BizError({
        message: `文件过大：${stats.size} > ${this.fileMaxBytes} 字节`,
        meta: { reason: "FILE_TOO_LARGE", size: stats.size, maxBytes: this.fileMaxBytes },
      });
    }

    const bytes = await readFile(source);
    const mimeType = detectMime(bytes);
    const resId = await ossClient.putObject({ bytes, mimeType });
    return { resId, mimeType, size: stats.size };
  }

  private requireOss(): OssClient {
    if (!this.ossClient) {
      throw new BizError({
        message: "OSS 未启用，无法读写文件资源",
        meta: { reason: "RESOURCE_OSS_DISABLED" },
      });
    }
    return this.ossClient;
  }

  /**
   * 把调用方给的相对/绝对路径钉进 fileRoot 沙箱，返回校验后的绝对路径。逃出根 → PATH_ESCAPE。
   * 通过 realpath 最深已存在祖先来防 symlink 逃逸：不存在的尾段还没落地、不可能是 symlink。
   */
  private async resolveWithinRoot(userPath: string): Promise<string> {
    await mkdir(this.fileRoot, { recursive: true });
    const realRoot = await realpath(this.fileRoot);
    const target = path.resolve(realRoot, userPath);

    let existing = target;
    while (existing !== path.dirname(existing) && !existsSync(existing)) {
      existing = path.dirname(existing);
    }
    const realExisting = await realpath(existing);
    const rest = path.relative(existing, target);
    const finalPath = rest.length > 0 ? path.join(realExisting, rest) : realExisting;

    if (finalPath !== realRoot && !finalPath.startsWith(realRoot + path.sep)) {
      throw new BizError({
        message: `路径逃出资源根目录：${userPath}`,
        meta: { reason: "PATH_ESCAPE", root: realRoot, resolved: finalPath },
      });
    }
    return finalPath;
  }
}

/** 展开开头的 ~ / ~/：与 terminal 的 initialCwd 解析同款语义。 */
function expandHome(p: string): string {
  const trimmed = p.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}
