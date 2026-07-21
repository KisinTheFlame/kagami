import { BizError } from "@kagami/kernel/errors/biz-error";
import { createBinaryClient, type BinaryClient } from "@kagami/rpc-client/binary-client";
import { ossApiContract } from "@kagami/oss-api/contract";

/**
 * 自建对象存储（@kagami/oss）的最小 HTTP client。gba 进程用它存取 ROM 字节：控制台上传时
 * putObject 换 key（元数据落 gba 自己的 sqlite），loadGame 时 getObject 拉回、deleteRom 时
 * best-effort 删除。
 *
 * 与 agent / napcat 侧的 acl/oss-client 同构（oss-api 契约驱动的薄封装，只依赖共享包）；
 * 各进程各持一份，避免跨 app 依赖（apps 不互相 import）。
 */
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
   * - 指定 maxBytes 时先看 content-length 早拒，再按实际字节数二次校验。
   * - 其余非 2xx → BizError(OSS_GET_FAILED)。
   */
  getObject(resId: string, opts?: { maxBytes?: number }): Promise<OssObject>;
  /** 删除对象。404（已不存在）视作成功；其余非 2xx 抛 BizError。 */
  deleteObject(resId: string): Promise<void>;
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
      decodeError: () => undefined,
      // 文案保持操作中立：本 client 同时承载 put/get/delete，底层失败不应一律标成「上传失败」
      //（那会把 loadGame 的读失败误标为写方向,误导排障）。
      mapFallbackError: info => {
        switch (info.reason) {
          case "bad_status":
            return new BizError({
              message: `OSS 请求失败：HTTP ${info.status}`,
              meta: { reason: "OSS_REQUEST_FAILED", status: info.status },
            });
          case "invalid_response_body":
            return new BizError({
              message: "OSS 返回结构无效（缺少 key）",
              meta: { reason: "OSS_INVALID_RESPONSE" },
            });
          case "unreachable":
            return new BizError({
              message: "OSS 不可达（未启动 / 半开 / 超时）",
              meta: { reason: "OSS_UNREACHABLE" },
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
    const { key } = await this.api.putObject({
      params: {},
      headers: { "content-type": mimeType },
      bytes: new Uint8Array(bytes),
    });
    return key;
  }

  public async getObject(resId: string, opts?: { maxBytes?: number }): Promise<OssObject> {
    const maxBytes = opts?.maxBytes;
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

  public async deleteObject(resId: string): Promise<void> {
    const response = await this.api.deleteObject({ params: { key: resId } });
    // 404 = 已不存在，删除的目的已达成（幂等）。
    if (!response.ok && response.status !== 404) {
      throw new BizError({
        message: `OSS 删除失败：HTTP ${response.status}`,
        meta: { reason: "OSS_DELETE_FAILED", status: response.status, resId },
      });
    }
  }
}
