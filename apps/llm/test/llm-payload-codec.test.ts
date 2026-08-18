import { describe, expect, it } from "vitest";
import {
  decodeBlob,
  encodeBlob,
  packRefs,
  serializeJsonBlob,
  serializeTextBlob,
  toDbBytes,
  unpackRefs,
} from "../src/app/llm-payload-codec.js";

describe("llm-payload-codec — blob 编解码", () => {
  it("可压缩内容走 zstd，往返还原逐字节相同", () => {
    const raw = Buffer.from("重复重复重复".repeat(500), "utf8");
    const encoded = encodeBlob(raw);

    expect(encoded.codec).toBe("zstd");
    expect(encoded.bytes.length).toBeLessThan(raw.length);
    // sizeBytes 记的是未压缩长度，压缩策略变了也不影响它。
    expect(encoded.sizeBytes).toBe(raw.length);
    expect(decodeBlob(encoded).equals(raw)).toBe(true);
  });

  it("压缩反增时退回 raw（短内容常见，p50 只有一百多字节）", () => {
    const raw = Buffer.from("a", "utf8");
    const encoded = encodeBlob(raw);

    expect(encoded.codec).toBe("raw");
    expect(encoded.bytes.equals(raw)).toBe(true);
    expect(decodeBlob(encoded).equals(raw)).toBe(true);
  });

  it("hash 算在未压缩原始字节上：同内容同 hash，异内容异 hash", () => {
    const raw = Buffer.from("同一段内容", "utf8");

    expect(encodeBlob(raw).hash.equals(encodeBlob(Buffer.from(raw)).hash)).toBe(true);
    expect(encodeBlob(raw).hash.equals(encodeBlob(Buffer.from("别的内容", "utf8")).hash)).toBe(
      false,
    );
    expect(encodeBlob(raw).hash).toHaveLength(32);
  });

  it("未知 codec 直接抛错，不猜", () => {
    expect(() => decodeBlob({ codec: "brotli", bytes: new Uint8Array([1]) })).toThrow(
      /未知的 llm_blob codec/,
    );
  });

  it("落单代理项经 JSON.stringify 转义后是合法 UTF-8，往返不丢", () => {
    // "\ud83d" 是半个 emoji。直接 Buffer.from(字符串) 会变成替换字符，必须先 stringify。
    const value = { content: "半个 emoji: \ud83d" };
    const raw = serializeJsonBlob(value);

    expect(raw.toString("utf8")).toContain("\\ud83d");
    expect(JSON.parse(raw.toString("utf8"))).toEqual(value);
    expect(decodeBlob(encodeBlob(raw)).equals(raw)).toBe(true);
  });

  it("serializeTextBlob 不套 JSON 引号（system 是裸字符串）", () => {
    expect(serializeTextBlob("你是小镜").toString("utf8")).toBe("你是小镜");
    expect(serializeJsonBlob("你是小镜").toString("utf8")).toBe('"你是小镜"');
  });
});

describe("llm-payload-codec — packed 引用数组", () => {
  it("空数组往返", () => {
    expect(packRefs([])).toHaveLength(0);
    expect(unpackRefs(new Uint8Array(0))).toEqual([]);
  });

  it("单条与大批量往返保序", () => {
    expect(unpackRefs(packRefs([7]))).toEqual([7]);

    const ids = Array.from({ length: 100_000 }, (_unused, index) => index + 1);
    expect(unpackRefs(packRefs(ids))).toEqual(ids);
  });

  it("id 越过 Uint32 上界直接抛错，不静默截断成错误引用", () => {
    expect(() => packRefs([0xffffffff])).not.toThrow();
    expect(() => packRefs([0x1_0000_0000])).toThrow(/超出 packed Uint32/);
    expect(() => packRefs([0])).toThrow(/超出 packed Uint32/);
    expect(() => packRefs([1.5])).toThrow(/超出 packed Uint32/);
  });

  it("长度不是 4 的倍数说明数据损坏，抛错而不是半还原", () => {
    expect(() => unpackRefs(new Uint8Array([0, 0, 1]))).toThrow(/不是 4 的倍数/);
  });

  it("toDbBytes 复制出独立 ArrayBuffer，不把 Buffer 内存池交给驱动", () => {
    const source = Buffer.from([1, 2, 3]);
    const copy = toDbBytes(source);

    expect([...copy]).toEqual([1, 2, 3]);
    expect(copy.buffer.byteLength).toBe(3);
    source[0] = 9;
    expect(copy[0]).toBe(1);
  });
});
