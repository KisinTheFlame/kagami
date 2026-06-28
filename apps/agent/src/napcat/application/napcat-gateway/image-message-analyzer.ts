import { AppLogger } from "@kagami/server-core/logger/logger";
import type { NapcatReceiveImageSegment } from "../../domain/napcat-segment.js";
import type { OssClient } from "../../../oss/oss-client.js";
import type { ImageAssetDao } from "../../infra/image-asset.dao.js";

const logger = new AppLogger({ source: "service.napcat-gateway" });

const MAX_IMAGE_DESCRIPTION_LENGTH = 180;

type FetchLike = typeof fetch;

/** 图片分析结果：vision 文字描述（失败为空串）+ OSS 存档 key（resid，未存档为 null）。 */
export type NapcatImageAnalysisResult = {
  description: string;
  resid: string | null;
};

export interface NapcatImageMessageAnalyzer {
  analyzeImageSegment(segment: NapcatReceiveImageSegment): Promise<NapcatImageAnalysisResult>;
}

type VisionImageAnalyzer = {
  analyzeImage(input: { content: Buffer; mimeType: string; filename?: string }): Promise<{
    description: string;
  }>;
};

type DefaultNapcatImageMessageAnalyzerDeps = {
  visionAgent: VisionImageAnalyzer;
  /** 自建 OSS client。省略则不存档原图（resid 恒为 null，优雅降级）。 */
  ossClient?: OssClient;
  /** file_id → {resid, description} 持久登记。省略则不走内容寻址缓存。 */
  imageAssetDao?: ImageAssetDao;
  fetch?: FetchLike;
};

const EMPTY_RESULT: NapcatImageAnalysisResult = { description: "", resid: null };

/**
 * QQ 图片的「唯一咽喉点」：下载图片字节，喂 vision 拿描述，并把原图存进自建 OSS 拿 resid。
 * 一次下载同时供 vision + 存档。按 file_id（内容 MD5）做内容寻址缓存——同一张图全局只下载/
 * 描述/PUT 一次，命中即复用，让 resid 跨消息稳定、不膨胀，且省掉重复 vision 开销。
 */
export class DefaultNapcatImageMessageAnalyzer implements NapcatImageMessageAnalyzer {
  private readonly visionAgent: VisionImageAnalyzer;
  private readonly ossClient: OssClient | null;
  private readonly imageAssetDao: ImageAssetDao | null;
  private readonly fetchImpl: FetchLike;

  public constructor({
    visionAgent,
    ossClient,
    imageAssetDao,
    fetch: fetchImpl,
  }: DefaultNapcatImageMessageAnalyzerDeps) {
    this.visionAgent = visionAgent;
    this.ossClient = ossClient ?? null;
    this.imageAssetDao = imageAssetDao ?? null;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async analyzeImageSegment(
    segment: NapcatReceiveImageSegment,
  ): Promise<NapcatImageAnalysisResult> {
    const fileId = segment.data.file;

    // 内容寻址命中：同一张图此前已下载/描述/存档，直接复用，连下载 + vision 都跳过。
    const cached = await this.lookupCache(fileId);
    if (cached) {
      return cached;
    }

    const downloaded = await this.download(segment.data.url);
    if (!downloaded) {
      return EMPTY_RESULT;
    }

    const { content, mimeType } = downloaded;
    const description = await this.describe({ content, mimeType, url: segment.data.url });
    const resid = await this.archive({ content, mimeType, url: segment.data.url });

    // 完整成功（描述 + 存档）才落库，让下次同图走缓存；OSS 挂时不缓存，下次重试。
    if (this.imageAssetDao && fileId && resid) {
      void this.imageAssetDao
        .upsert({ fileId, resid, description, mime: mimeType })
        .catch(error => {
          logger.warn("Failed to persist image asset", {
            event: "napcat.gateway.image_asset_upsert_failed",
            fileId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    return { description, resid };
  }

  private async lookupCache(fileId: string): Promise<NapcatImageAnalysisResult | null> {
    if (!this.imageAssetDao || !fileId) {
      return null;
    }
    try {
      const cached = await this.imageAssetDao.findByFileId(fileId);
      return cached ? { description: cached.description, resid: cached.resid } : null;
    } catch (error) {
      logger.warn("Failed to look up cached image asset", {
        event: "napcat.gateway.image_asset_lookup_failed",
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async download(imageUrl: string): Promise<{ content: Buffer; mimeType: string } | null> {
    try {
      const response = await this.fetchImpl(imageUrl);
      if (!response.ok) {
        logger.warn("Failed to download NapCat image for vision analysis", {
          event: "napcat.gateway.image_download_failed",
          status: response.status,
          url: imageUrl,
        });
        return null;
      }

      const mimeType = inferImageMimeType({
        url: imageUrl,
        contentType: response.headers.get("content-type"),
      });
      if (!mimeType) {
        logger.warn("Failed to infer image mime type for NapCat image", {
          event: "napcat.gateway.image_mime_type_invalid",
          url: imageUrl,
        });
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const content = Buffer.from(arrayBuffer);
      if (content.byteLength === 0) {
        logger.warn("Downloaded NapCat image is empty", {
          event: "napcat.gateway.image_download_empty",
          url: imageUrl,
        });
        return null;
      }

      return { content, mimeType };
    } catch (error) {
      logger.errorWithCause("Failed to download NapCat image", error, {
        event: "napcat.gateway.image_download_error",
        url: imageUrl,
      });
      return null;
    }
  }

  private async describe(input: {
    content: Buffer;
    mimeType: string;
    url: string;
  }): Promise<string> {
    try {
      const result = await this.visionAgent.analyzeImage({
        content: input.content,
        mimeType: input.mimeType,
        filename: inferFilenameFromUrl(input.url),
      });
      return sanitizeVisionDescription(result.description);
    } catch (error) {
      logger.errorWithCause("Failed to analyze NapCat image with vision agent", error, {
        event: "napcat.gateway.image_analysis_failed",
        url: input.url,
      });
      return "";
    }
  }

  private async archive(input: {
    content: Buffer;
    mimeType: string;
    url: string;
  }): Promise<string | null> {
    if (!this.ossClient) {
      return null;
    }
    try {
      return await this.ossClient.putObject({ bytes: input.content, mimeType: input.mimeType });
    } catch (error) {
      logger.warn("Failed to archive NapCat image to OSS", {
        event: "napcat.gateway.image_oss_archive_failed",
        url: input.url,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function sanitizeVisionDescription(description: string): string {
  const flattened = description
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^#{1,6}\s*/, ""))
    .map(line => line.replace(/^[-*]\s+/, ""))
    .map(line => line.replace(/^\d+[.)]\s*/, ""))
    .join("；")
    .replace(/如果你愿意，我还可以.*$/u, "")
    .replace(/如果需要，我还可以.*$/u, "")
    .replace(/\s+/g, " ")
    .replace(/；{2,}/g, "；")
    .trim()
    .replace(/[；，。、\s]+$/u, "");

  if (flattened.length <= MAX_IMAGE_DESCRIPTION_LENGTH) {
    return flattened;
  }

  return `${flattened.slice(0, MAX_IMAGE_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

export function inferImageMimeType(input: {
  url: string;
  contentType: string | null;
}): string | null {
  const headerMimeType = input.contentType?.split(";")[0]?.trim().toLowerCase() ?? null;
  if (headerMimeType?.startsWith("image/")) {
    return headerMimeType;
  }

  const filename = inferFilenameFromUrl(input.url);
  if (!filename) {
    return null;
  }

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return null;
  }
}

function inferFilenameFromUrl(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname.trim();
    if (!pathname) {
      return undefined;
    }

    const filename = pathname.split("/").pop()?.trim();
    return filename && filename.length > 0 ? filename : undefined;
  } catch {
    return undefined;
  }
}
