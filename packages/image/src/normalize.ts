import sharp from "sharp";

/**
 * 图片归一化：让任何来源的图在进 LLM 上下文 / vision 之前满足两个约束（#556）：
 *
 * 1. **不炸**：Anthropic /v1/messages 对图片有单边 ≤8000px 硬限制，超限 400。一张超限图
 *    进了持久上下文就是每轮 400 的毒消息（2026-07-23 事故：429×8183 长截图打挂主 Agent）。
 * 2. **可读**：长边 >1568px 的图会被 provider 服务端等比缩到 1568。超长截图整图直发，
 *    模型看到的是缩成细条的糊图，文字不可读——切片是用 token 换可读性。
 *
 * 规则（normalizeImageForLlm）：
 * - 解码失败 → fail-open 原样透传（不因归一化引入新的丢图路径），由 wire 层保险丝兜底。
 * - 宽高比 ≤4:1：长边 ≤1568 直通（字节不动）；否则等比缩到长边 1568，单 part。
 * - 宽高比 >4:1 且长边 >1568（极端长图）：沿长轴切片，片长边 1536、相邻重叠 80px；
 *   预计超过 6 片先整体等比缩放到恰好 6 片可覆盖再切。
 *
 * 变换是确定性的：同 sharp 版本 + 同输入字节 → 同输出字节。下游 Files API 的 sha256
 * 缓存与 KV 前缀稳定性以变换后字节为准，不受影响。输出剥离元数据（sharp 默认行为），
 * EXIF 方向先应用再处理；带 alpha 输出 png，否则 jpeg quality 85；动画图静态化（取首帧）。
 */

/** 直通上限 & 缩放目标：provider 服务端反正会缩到 1568，超过它只是白付载荷。 */
const SCALE_TARGET_LONG_EDGE = 1568;
/** 切片长边：留余量不顶死 1568。 */
const TILE_LONG_EDGE = 1536;
/** 相邻切片重叠：防文字行/聊天气泡恰好被边界切断。 */
const TILE_OVERLAP = 80;
/** 单图切片上限：持久上下文里一条消息最多带的 tile 数，超出先降采样。 */
const MAX_TILES = 6;
/** 进入切片分支的宽高比阈值。 */
const EXTREME_ASPECT_RATIO = 4;
/** API 保险丝：贴着 8000px 硬限制留实现误差余量。 */
const API_MAX_EDGE = 7900;
/** 解码/保险丝总像素上限（40MP）。 */
const MAX_PIXELS = 40_000_000;

const JPEG_QUALITY = 85;

export type NormalizedImagePart = {
  readonly bytes: Buffer;
  readonly mimeType: string;
  /** 切片序号（1-based）；未切片时缺省。 */
  readonly tile?: { readonly index: number; readonly total: number };
};

export type NormalizeImageResult = {
  readonly parts: readonly NormalizedImagePart[];
  /** false = 原字节直通（未重编码）。 */
  readonly transformed: boolean;
};

export type ClampImageResult = {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly clamped: boolean;
  /** clamped 为 true 时的原始 / 目标尺寸（诊断日志用，不含图片内容）。 */
  readonly fromSize?: { readonly width: number; readonly height: number };
  readonly toSize?: { readonly width: number; readonly height: number };
};

type DecodedDimensions = {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
};

/** 读取应用 EXIF 方向后的有效尺寸；解码不了返回 null（上层 fail-open）。 */
async function readDimensions(bytes: Buffer): Promise<DecodedDimensions | null> {
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) {
      return null;
    }
    // EXIF orientation 5-8 是旋转 90°/270°，宽高互换。
    const swapped = metadata.orientation !== undefined && metadata.orientation >= 5;
    return {
      width: swapped ? metadata.height : metadata.width,
      height: swapped ? metadata.width : metadata.height,
      hasAlpha: metadata.hasAlpha ?? false,
    };
  } catch {
    return null;
  }
}

/** 统一输出编码：带 alpha 保 png（透明不丢），否则 jpeg q85。 */
function encodePipeline(pipeline: sharp.Sharp, hasAlpha: boolean): Promise<Buffer> {
  return hasAlpha ? pipeline.png().toBuffer() : pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

function outputMime(hasAlpha: boolean): string {
  return hasAlpha ? "image/png" : "image/jpeg";
}

export async function normalizeImageForLlm(
  bytes: Buffer,
  mimeType: string,
): Promise<NormalizeImageResult> {
  const dims = await readDimensions(bytes);
  if (dims === null) {
    return { parts: [{ bytes, mimeType }], transformed: false };
  }

  const longEdge = Math.max(dims.width, dims.height);
  const shortEdge = Math.min(dims.width, dims.height);
  const aspect = longEdge / shortEdge;

  if (longEdge <= SCALE_TARGET_LONG_EDGE) {
    return { parts: [{ bytes, mimeType }], transformed: false };
  }

  if (aspect <= EXTREME_ASPECT_RATIO) {
    const scale = SCALE_TARGET_LONG_EDGE / longEdge;
    const output = await encodePipeline(
      sharp(bytes)
        .rotate()
        .resize({
          width: Math.max(1, Math.round(dims.width * scale)),
          height: Math.max(1, Math.round(dims.height * scale)),
          fit: "fill",
        }),
      dims.hasAlpha,
    );
    return {
      parts: [{ bytes: output, mimeType: outputMime(dims.hasAlpha) }],
      transformed: true,
    };
  }

  return sliceExtremeImage(bytes, dims);
}

/**
 * 极端长图切片。步长 = 1536 − 80；N = ceil((L − 80) / step)；最后一片对齐末尾（重叠可
 * 略大于 80）。预计超过 6 片先整体等比缩放到 L = 80 + step×6，再按同一公式切恰好 6 片。
 * 短边超过 1536 时同步压到 1536（保证 tile 任一边 ≤1536）。
 */
async function sliceExtremeImage(
  bytes: Buffer,
  dims: DecodedDimensions,
): Promise<NormalizeImageResult> {
  const vertical = dims.height >= dims.width;
  let longEdge = vertical ? dims.height : dims.width;
  let shortEdge = vertical ? dims.width : dims.height;

  const step = TILE_LONG_EDGE - TILE_OVERLAP;
  const maxCoverableLength = TILE_OVERLAP + step * MAX_TILES;

  let scale = 1;
  if (longEdge > maxCoverableLength) {
    scale = maxCoverableLength / longEdge;
  }
  if (shortEdge * scale > TILE_LONG_EDGE) {
    scale = TILE_LONG_EDGE / shortEdge;
  }

  let prepared = bytes;
  if (scale < 1) {
    longEdge = Math.max(1, Math.floor(longEdge * scale));
    shortEdge = Math.max(1, Math.floor(shortEdge * scale));
    prepared = await sharp(bytes)
      .rotate()
      .resize({
        width: vertical ? shortEdge : longEdge,
        height: vertical ? longEdge : shortEdge,
        fit: "fill",
      })
      .png()
      .toBuffer();
  }

  const tileLength = Math.min(TILE_LONG_EDGE, longEdge);
  const total = Math.max(1, Math.ceil((longEdge - TILE_OVERLAP) / step));

  const parts: NormalizedImagePart[] = [];
  for (let index = 0; index < total; index += 1) {
    const start = Math.min(index * step, longEdge - tileLength);
    const region = vertical
      ? { left: 0, top: start, width: shortEdge, height: tileLength }
      : { left: start, top: 0, width: tileLength, height: shortEdge };
    // scale===1 时 prepared 是原始字节，仍需 rotate() 先应用 EXIF 方向再裁剪。
    const tileBytes = await encodePipeline(sharp(prepared).rotate().extract(region), dims.hasAlpha);
    parts.push({
      bytes: tileBytes,
      mimeType: outputMime(dims.hasAlpha),
      tile: { index: index + 1, total },
    });
  }

  return { parts, transformed: true };
}

/**
 * wire 层保险丝：单边 ≤7900 且总像素 ≤40MP，超限确定性等比降采样。这是最后一道防线，
 * 保证任何来源（漏接归一化的入口、未来新 capability）都不可能再把超限图发到 API 引发
 * 400 毒上下文。解码失败原样透传（保持现状行为，由调用方决定是否告警）。
 */
export async function clampToApiLimit(bytes: Buffer, mimeType: string): Promise<ClampImageResult> {
  const dims = await readDimensions(bytes);
  if (dims === null) {
    return { bytes, mimeType, clamped: false };
  }

  const longEdge = Math.max(dims.width, dims.height);
  const pixels = dims.width * dims.height;
  if (longEdge <= API_MAX_EDGE && pixels <= MAX_PIXELS) {
    return { bytes, mimeType, clamped: false };
  }

  const scale = Math.min(API_MAX_EDGE / longEdge, Math.sqrt(MAX_PIXELS / pixels));
  const targetWidth = Math.max(1, Math.floor(dims.width * scale));
  const targetHeight = Math.max(1, Math.floor(dims.height * scale));
  const output = await encodePipeline(
    sharp(bytes).rotate().resize({ width: targetWidth, height: targetHeight, fit: "fill" }),
    dims.hasAlpha,
  );
  return {
    bytes: output,
    mimeType: outputMime(dims.hasAlpha),
    clamped: true,
    fromSize: { width: dims.width, height: dims.height },
    toSize: { width: targetWidth, height: targetHeight },
  };
}
