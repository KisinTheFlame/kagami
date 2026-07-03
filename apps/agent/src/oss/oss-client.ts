import { BizError } from "@kagami/kernel/errors/biz-error";
import { createBinaryClient, type BinaryClient } from "@kagami/rpc-client/binary-client";
import { ossApiContract } from "@kagami/oss-api/contract";

/**
 * 自建对象存储（@kagami/oss）的最小 HTTP client：把「bytes + content-type」PUT 进去，拿对外
 * key（resid）。对标 S3 / MinIO 的 typed object store——content-type 随对象存取，但 client 不关心
 * 图片等媒体语义（isImage 之类的判定留给上层 resource service）。
 *
 * wire 层走 @kagami/oss-api 契约驱动的 createBinaryClient（issue #310）：putObject 是 binary-envelope
 * （上行字节 + content-type 头、下行 `{ key }` 信封，全由工厂处理，错误码经 mapFallbackError 归一）；
 * getObject 是 binary-raw（工厂只做 URL 插值 + fetch，返回裸 Response），下面所有 404 / maxBytes /
 * mime 兜底都是领域逻辑、留在本 client。
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

export class HttpOssClient implements OssClient {
  private readonly api: BinaryClient<typeof ossApiContract>;

  public constructor({ baseUrl, fetch: fetchImpl }: HttpOssClientDeps) {
    this.api = createBinaryClient(ossApiContract, {
      baseUrl,
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      // 服务端 putObject 的非 2xx 错误体不是 BizErrorWire；关掉默认富信封解码，否则会被截获、
      // 非 2xx 不再归一为 OSS_PUT_FAILED（issue #310）。仅 putObject（envelope）会走到这里，
      // getObject（raw）返回裸 Response、错误由下方领域逻辑处理，与本 mapper 无关。
      decodeError: () => undefined,
      mapFallbackError: info => {
        switch (info.reason) {
          case "bad_status":
            return new BizError({
              message: `OSS 上传失败：HTTP ${info.status}`,
              meta: { reason: "OSS_PUT_FAILED", status: info.status },
            });
          case "invalid_response_body":
            return new BizError({
              message: "OSS 返回结构无效（缺少 key）",
              meta: { reason: "OSS_PUT_INVALID_RESPONSE" },
            });
          case "unreachable":
            return new BizError({
              message: "OSS 上传失败：服务不可达（未启动 / 半开 / 超时）",
              meta: { reason: "OSS_PUT_FAILED" },
              cause: info.cause,
            });
        }
      },
    });
  }

  public async putObject({
    bytes,
    mimeType,
  }: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<string> {
    // Buffer 是 Uint8Array 子类，但契约 body 类型是 Uint8Array，转一下更贴类型。
    const { key } = await this.api.putObject({
      params: {},
      headers: { "content-type": mimeType },
      bytes: new Uint8Array(bytes),
    });
    return key;
  }

  public async getObject(resId: string, opts?: { maxBytes?: number }): Promise<OssObject> {
    const maxBytes = opts?.maxBytes;
    // binary-raw：工厂只插值 path + fetch，返回裸 Response；下面全是领域逻辑。
    const response = await this.api.getObject({ params: { key: resId } });

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
}
