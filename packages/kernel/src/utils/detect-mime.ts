/**
 * 「字节 → content-type」的单一探测器：调用方在把对象 PUT 进 OSS 之前，用它算出权威的
 * content-type。OSS 服务端刻意不嗅探（信任 client 传来的 content-type，和 S3/MinIO 对齐），
 * 所以这一步留在 agent 侧。
 *
 * 策略（决策 A，宽容派）：
 *   1. 先按 magic bytes 识别 —— 命中即权威，无视 header / URL 扩展名（比两者都可靠）。
 *   2. 识别不出时，若 headerHint 是 image/* 就信任它（兼容 magic 表没覆盖的合法图，如某些
 *      WebP 变体；代价是偶发把错标 image 的非图字节也放过，由调用方自行决定后续处理）。
 *   3. 否则回退 application/octet-stream。
 *
 * SVG 是文本型、无稳定 magic，刻意不 sniff —— 只能靠 headerHint 识别。
 */

const OCTET_STREAM = "application/octet-stream";

export function detectMime(bytes: Buffer, headerHint?: string | null): string {
  const sniffed = sniffMagicBytes(bytes);
  if (sniffed) {
    return sniffed;
  }
  const hint = normalizeHint(headerHint);
  if (hint && hint.startsWith("image/")) {
    return hint;
  }
  return OCTET_STREAM;
}

/** 取 content-type 头的主类型：去掉 `; charset=...`、trim、小写。 */
function normalizeHint(headerHint?: string | null): string | null {
  const main = headerHint?.split(";")[0]?.trim().toLowerCase();
  return main && main.length > 0 ? main : null;
}

/** 按文件头 magic bytes 识别常见图片格式；识别不出返回 null。 */
function sniffMagicBytes(bytes: Buffer): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  // GIF87a / GIF89a：前缀 "GIF8" + 第 5 字节 '7'|'9' + 第 6 字节 'a'
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  // RIFF....WEBP：0-3 = "RIFF"，8-11 = "WEBP"
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  // "BM"
  if (startsWith(bytes, [0x42, 0x4d])) {
    return "image/bmp";
  }
  // ISO-BMFF（AVIF / HEIC）：4-7 = "ftyp"，major brand 在 8-11。只认明确的 AVIF / HEIC brand；
  // 泛 HEIF 容器 brand（mif1 / msf1）刻意不认——它既可能是 AVIF 也可能是 HEIC，硬归一会错标，
  // 让它回落到 header hint 更安全。
  if (asciiAt(bytes, 4, 4) === "ftyp") {
    const brand = asciiAt(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") {
      return "image/avif";
    }
    if (HEIC_BRANDS.has(brand)) {
      return "image/heic";
    }
  }
  return null;
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

function startsWith(bytes: Buffer, signature: number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

/** 读 [offset, offset+length) 的 ASCII；越界返回空串。 */
function asciiAt(bytes: Buffer, offset: number, length: number): string {
  if (bytes.length < offset + length) {
    return "";
  }
  return bytes.toString("latin1", offset, offset + length);
}
