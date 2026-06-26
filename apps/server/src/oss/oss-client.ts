import { z } from "zod";
import { BizError } from "../common/errors/biz-error.js";

/**
 * 自建对象存储（@kagami/oss）的最小 HTTP client：把二进制 PUT 进去，拿对外 key（resid）。
 * 业务无关——只认 bytes + mime，不关心图片语义。
 */
export interface OssClient {
  /** 上传一份二进制对象，返回对外不透明 key（`res-<id>`）。失败抛 BizError。 */
  putObject(input: { bytes: Buffer; mimeType: string }): Promise<string>;
}

type FetchLike = typeof fetch;

type HttpOssClientDeps = {
  baseUrl: string;
  fetch?: FetchLike;
};

const PutObjectResponseSchema = z.object({
  key: z.string().min(1),
});

export class HttpOssClient implements OssClient {
  private readonly objectsUrl: string;
  private readonly fetchImpl: FetchLike;

  public constructor({ baseUrl, fetch: fetchImpl }: HttpOssClientDeps) {
    this.objectsUrl = `${baseUrl.replace(/\/+$/, "")}/objects`;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async putObject({
    bytes,
    mimeType,
  }: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<string> {
    const response = await this.fetchImpl(this.objectsUrl, {
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
}
