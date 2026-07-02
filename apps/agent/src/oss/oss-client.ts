import { BizError } from "@kagami/kernel/errors/biz-error";
import { interpolatePath } from "@kagami/http/url";
import { ossApiContract } from "@kagami/oss-api/contract";

/**
 * 自建对象存储（@kagami/oss）的最小 HTTP client：把「bytes + content-type」PUT 进去，拿对外
 * key（resid）。对标 S3 / MinIO 的 typed object store——content-type 随对象存取，但 client 不关心
 * 图片等媒体语义（isImage 之类的判定留给上层 resource service）。
 */
/** getObject 取回的一份资源：原始字节 + MIME + 字节数。 */
export type OssObject = {
  bytes: Buffer;
  mimeType: string;
  size: number;
};

export interface OssClient {
  /** 上传一份二进制对象，返回对外不透明 key（`res-<id>`）。失败抛 BizError。 */
  putObject(input: { bytes: Buffer; mimeType: string }): Promise<string>;
  /**
   * 按 resId 取回一份对象的字节 + MIME。
   * - 404 → BizError(OSS_OBJECT_NOT_FOUND)
   * - 指定 maxBytes 时：先看 content-length 早拒，再按"实际读到的字节数"二次校验，
   *   任一超限 → BizError(OSS_OBJECT_TOO_LARGE)。content-length 缺失也靠实际字节兜底，
   *   不只信 header。
   * - 其余非 2xx → BizError(OSS_GET_FAILED)。
   */
  getObject(resId: string, opts?: { maxBytes?: number }): Promise<OssObject>;
}

type FetchLike = typeof fetch;

type HttpOssClientDeps = {
  baseUrl: string;
  fetch?: FetchLike;
};

// putObject 响应信封的单一事实源在 @kagami/oss-api；此处只引用，杜绝本地重定义漂移。
const PutObjectResponseSchema = ossApiContract.putObject.output;

export class HttpOssClient implements OssClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor({ baseUrl, fetch: fetchImpl }: HttpOssClientDeps) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async putObject({
    bytes,
    mimeType,
  }: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}${ossApiContract.putObject.path}`, {
      method: "POST",
      headers: { "content-type": mimeType },
      // Buffer 是 Uint8Array 子类，但 fetch 的 BodyInit 类型不直接收 Buffer，转成 Uint8Array。
      body: new Uint8Array(bytes),
    });

    if (!response.ok) {
      throw new BizError({
        message: `OSS 上传失败：HTTP ${response.status}`,
        meta: { reason: "OSS_PUT_FAILED", status: response.status },
      });
    }

    const parsed = PutObjectResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new BizError({
        message: "OSS 返回结构无效（缺少 key）",
        meta: { reason: "OSS_PUT_INVALID_RESPONSE" },
      });
    }

    return parsed.data.key;
  }

  public async getObject(resId: string, opts?: { maxBytes?: number }): Promise<OssObject> {
    const maxBytes = opts?.maxBytes;
    const url = this.objectUrl(resId);
    const response = await this.fetchImpl(url, { method: "GET" });

    if (response.status === 404) {
      throw new BizError({
        message: `OSS 对象不存在：${resId}`,
        meta: { reason: "OSS_OBJECT_NOT_FOUND", resId },
      });
    }
    if (!response.ok) {
      throw new BizError({
        message: `OSS 读取失败：HTTP ${response.status}`,
        meta: { reason: "OSS_GET_FAILED", status: response.status, resId },
      });
    }

    // content-length 早拒：能提前知道超限就别把整块下载下来。但它可能缺失或被代理改写，
    // 所以下载完还要按实际字节数兜底校验。
    if (maxBytes !== undefined) {
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new BizError({
          message: `OSS 对象过大：${declared} > ${maxBytes} 字节`,
          meta: { reason: "OSS_OBJECT_TOO_LARGE", declared, maxBytes, resId },
        });
      }
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
      throw new BizError({
        message: `OSS 对象过大：${bytes.byteLength} > ${maxBytes} 字节`,
        meta: { reason: "OSS_OBJECT_TOO_LARGE", actual: bytes.byteLength, maxBytes, resId },
      });
    }

    const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
    return { bytes, mimeType, size: bytes.byteLength };
  }

  private objectUrl(resId: string): string {
    // 路径与服务端路由共享契约字符串（/objects/:key），插值即 encodeURIComponent。
    return `${this.baseUrl}${interpolatePath(ossApiContract.getObject.path, { key: resId })}`;
  }
}
