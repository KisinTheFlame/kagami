import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPRESS_RATIO,
  describeCompressRatioError,
  parseCompressRatio,
} from "../src/pages/control-panel/compress-ratio";

describe("parseCompressRatio", () => {
  it("接受区间内的整数，并容忍前后空格", () => {
    expect(parseCompressRatio("90")).toEqual({ ok: true, value: 90 });
    expect(parseCompressRatio(" 10 ")).toEqual({ ok: true, value: 10 });
    expect(parseCompressRatio("100")).toEqual({ ok: true, value: 100 });
  });

  it("默认档在合法区间内", () => {
    expect(parseCompressRatio(String(DEFAULT_COMPRESS_RATIO))).toEqual({
      ok: true,
      value: DEFAULT_COMPRESS_RATIO,
    });
  });

  it("空串和纯空格判为 empty", () => {
    expect(parseCompressRatio("")).toEqual({ ok: false, reason: "empty" });
    expect(parseCompressRatio("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("非整数判为 not-integer", () => {
    expect(parseCompressRatio("90.5")).toEqual({ ok: false, reason: "not-integer" });
    expect(parseCompressRatio("abc")).toEqual({ ok: false, reason: "not-integer" });
    expect(parseCompressRatio("-10")).toEqual({ ok: false, reason: "not-integer" });
    expect(parseCompressRatio("1e2")).toEqual({ ok: false, reason: "not-integer" });
  });

  it("越界判为 out-of-range", () => {
    expect(parseCompressRatio("0")).toEqual({ ok: false, reason: "out-of-range" });
    expect(parseCompressRatio("9")).toEqual({ ok: false, reason: "out-of-range" });
    expect(parseCompressRatio("101")).toEqual({ ok: false, reason: "out-of-range" });
  });
});

describe("describeCompressRatioError", () => {
  it("每种失败原因都有可读文案", () => {
    expect(describeCompressRatioError("empty")).toContain("压缩比例");
    expect(describeCompressRatioError("not-integer")).toContain("整数");
    expect(describeCompressRatioError("out-of-range")).toContain("10");
  });
});
