import { AppLogger } from "../../../logger/logger.js";
import type { NapcatReceiveImageSegment } from "../../schema/napcat-segment.js";

const logger = new AppLogger({ source: "service.napcat-gateway" });

const FALLBACK_IMAGE_TEXT = "[图片]";
const IMAGE_TEXT_PREFIX = "[图片: ";
const IMAGE_TEXT_SUFFIX = "]";
const MAX_IMAGE_DESCRIPTION_LENGTH = 180;

type FetchLike = typeof fetch;

export interface NapcatImageMessageAnalyzer {
  analyzeImageSegment(segment: NapcatReceiveImageSegment): Promise<string>;
}

type VisionImageAnalyzer = {
  analyzeImage(input: { content: Buffer; mimeType: string; filename?: string }): Promise<{
    description: string;
  }>;
};

type DefaultNapcatImageMessageAnalyzerDeps = {
  visionAgent: VisionImageAnalyzer;
  fetch?: FetchLike;
};

export class DefaultNapcatImageMessageAnalyzer implements NapcatImageMessageAnalyzer {
  private readonly visionAgent: VisionImageAnalyzer;
  private readonly fetchImpl: FetchLike;

  public constructor({ visionAgent, fetch: fetchImpl }: DefaultNapcatImageMessageAnalyzerDeps) {
    this.visionAgent = visionAgent;
    this.fetchImpl = fetchImpl ?? fetch;
  }

  public async analyzeImageSegment(segment: NapcatReceiveImageSegment): Promise<string> {
    const imageUrl = segment.data.url;

    try {
      const response = await this.fetchImpl(imageUrl);
      if (!response.ok) {
        logger.warn("Failed to download NapCat image for vision analysis", {
          event: "napcat.gateway.image_download_failed",
          status: response.status,
          url: imageUrl,
        });
        return FALLBACK_IMAGE_TEXT;
      }

      const contentType = response.headers.get("content-type");
      const mimeType = inferImageMimeType({
        url: imageUrl,
        contentType,
      });
      if (!mimeType) {
        logger.warn("Failed to infer image mime type for NapCat image", {
          event: "napcat.gateway.image_mime_type_invalid",
          contentType,
          url: imageUrl,
        });
        return FALLBACK_IMAGE_TEXT;
      }

      const arrayBuffer = await response.arrayBuffer();
      const content = Buffer.from(arrayBuffer);
      if (content.byteLength === 0) {
        logger.warn("Downloaded NapCat image is empty", {
          event: "napcat.gateway.image_download_empty",
          url: imageUrl,
        });
        return FALLBACK_IMAGE_TEXT;
      }

      const result = await this.visionAgent.analyzeImage({
        content,
        mimeType,
        filename: inferFilenameFromUrl(imageUrl),
      });
      return formatImageText(result.description);
    } catch (error) {
      logger.errorWithCause("Failed to analyze NapCat image with vision agent", error, {
        event: "napcat.gateway.image_analysis_failed",
        url: imageUrl,
      });
      return FALLBACK_IMAGE_TEXT;
    }
  }
}

export function formatImageText(description: string): string {
  const text = sanitizeVisionDescription(description);
  if (text.length === 0) {
    return FALLBACK_IMAGE_TEXT;
  }

  return `${IMAGE_TEXT_PREFIX}${text}${IMAGE_TEXT_SUFFIX}`;
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
