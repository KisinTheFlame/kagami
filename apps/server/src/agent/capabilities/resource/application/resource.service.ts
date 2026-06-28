import { BizError } from "@kagami/server-core/common/errors/biz-error";
import type { OssClient } from "../../../../oss/oss-client.js";

/** 一份按 resId 解出的资源：原图字节 + MIME + 字节数 + 是否图片。 */
export type ResolvedResource = {
  resId: string;
  bytes: Buffer;
  mimeType: string;
  size: number;
  isImage: boolean;
};

const RESOURCE_ID_PATTERN = /^res-\d+$/;

/**
 * 资源读取的业务层：把 OSS 的「字节 + MIME」翻成带媒体语义的资源。read_resource /
 * send_resource 共用这一层——它负责 resId 格式校验、大小护栏、图片/非图片分类，
 * OSS 关闭时优雅报错。OSS client 只认 bytes/mime，媒体语义不外泄到 oss-client。
 */
export class ResourceService {
  private readonly ossClient: OssClient | undefined;
  private readonly maxBytes: number;

  public constructor({ ossClient, maxBytes }: { ossClient?: OssClient; maxBytes: number }) {
    this.ossClient = ossClient;
    this.maxBytes = maxBytes;
  }

  /**
   * 按 resId 解出一份资源。校验失败 / OSS 关闭 / 不存在 / 超限都抛 BizError（带
   * meta.reason），由调用方工具翻成自包含的错误文案。
   */
  public async resolve(resId: string): Promise<ResolvedResource> {
    if (!this.ossClient) {
      throw new BizError({
        message: "OSS 未启用，无法读取资源",
        meta: { reason: "RESOURCE_OSS_DISABLED" },
      });
    }
    if (!RESOURCE_ID_PATTERN.test(resId)) {
      throw new BizError({
        message: `资源 id 形如 res-<数字>，收到的是：${resId}`,
        meta: { reason: "INVALID_RESOURCE_ID", resId },
      });
    }

    const object = await this.ossClient.getObject(resId, { maxBytes: this.maxBytes });
    return {
      resId,
      bytes: object.bytes,
      mimeType: object.mimeType,
      size: object.size,
      isImage: object.mimeType.startsWith("image/"),
    };
  }
}
