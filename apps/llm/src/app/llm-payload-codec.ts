import { createHash } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

/**
 * `llm_blob` 的编解码原语（issue #612）。全是纯函数，不碰 DB，单测主战场。
 *
 * 三条不变量，改动前先读：
 *
 * 1. **hash 永远算在未压缩的原始字节上**。压缩策略变了（换 codec、调阈值）也不会让同一段内容
 *    换个 hash，否则每次调参都要把整库去重表作废重建。
 * 2. **原始字节一律经 `JSON.stringify` / `Buffer.from(..., "utf8")` 产生**。`JSON.stringify`
 *    遵循 well-formed 语义，会把落单代理项（lone surrogate）转义成 `\udXXX` 字面量，输出串
 *    必定是合法 UTF-8。禁止手工拼字符串再转 Buffer——本仓库为落单代理项挂过一次（半个 emoji
 *    进上下文导致每轮 400），那一类字节绝不能在这层被替换字符吞掉。
 * 3. **不做 key 顺序规范化**。message 对象每轮由同一段代码构造，顺序天然稳定；万一哪天不稳定，
 *    后果只是多存一个 blob（去重率下降），不会产生错误数据。为此引入 canonical-JSON 是白付复杂度。
 */

type LlmBlobCodec = "raw" | "zstd";

export type EncodedBlob = {
  /** 未压缩原始字节的 sha256（32 B）。 */
  hash: Buffer;
  codec: LlmBlobCodec;
  /** 未压缩字节数。 */
  sizeBytes: number;
  /** 实际入库字节（按 codec）。 */
  bytes: Buffer;
};

/** `message_refs` 里单个引用的上界：packed Uint32。 */
const MAX_BLOB_ID = 0xffffffff;
const REF_BYTES = 4;

/** 一条 message / 一份 tools 这类 JSON 值的原始字节。 */
export function serializeJsonBlob(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

/** `system` 是裸字符串，不套一层 JSON 引号。 */
export function serializeTextBlob(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

export function encodeBlob(raw: Buffer): EncodedBlob {
  const hash = createHash("sha256").update(raw).digest();
  const compressed = zstdCompressSync(raw);
  // 压缩反增（短内容常见，p50 只有 138 B）时退回 raw：省下的解压 CPU 比多出的字节值钱。
  const useCompressed = compressed.length < raw.length;

  return {
    hash,
    codec: useCompressed ? "zstd" : "raw",
    sizeBytes: raw.length,
    bytes: useCompressed ? compressed : raw,
  };
}

export function decodeBlob(input: { codec: string; bytes: Uint8Array }): Buffer {
  const bytes = Buffer.from(input.bytes);
  if (input.codec === "raw") {
    return bytes;
  }
  if (input.codec === "zstd") {
    return Buffer.from(zstdDecompressSync(bytes));
  }

  throw new Error(`未知的 llm_blob codec: ${input.codec}`);
}

/**
 * Prisma 的 Bytes 列要 `Uint8Array<ArrayBuffer>`，而 Node 的 `Buffer` 是
 * `Uint8Array<ArrayBufferLike>`（底层常是共享的内存池），两者类型不兼容。`new Uint8Array(buf)`
 * 复制出独立 ArrayBuffer，既满足类型也避免把内存池的其余部分连带交给驱动。
 */
export function toDbBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(buffer.length));
  copy.set(buffer);

  return copy;
}

export function packRefs(ids: readonly number[]): Buffer {
  const packed = Buffer.allocUnsafe(ids.length * REF_BYTES);
  ids.forEach((id, index) => {
    if (!Number.isInteger(id) || id < 1 || id > MAX_BLOB_ID) {
      // 按当前量级（每天数千 blob）这条永不触发，它只防将来悄悄溢出成错误引用。
      throw new Error(`llm_blob id 超出 packed Uint32 可表示范围: ${id}`);
    }
    packed.writeUInt32BE(id, index * REF_BYTES);
  });

  return packed;
}

export function unpackRefs(bytes: Uint8Array): number[] {
  if (bytes.length % REF_BYTES !== 0) {
    // 数据损坏就该炸，不该静默半还原成一串看起来正常的 id。
    throw new Error(`message_refs 长度 ${bytes.length} 不是 ${REF_BYTES} 的倍数`);
  }

  const buffer = Buffer.from(bytes);
  const ids: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += REF_BYTES) {
    ids.push(buffer.readUInt32BE(offset));
  }

  return ids;
}
