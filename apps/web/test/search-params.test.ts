import { describe, expect, it } from "vitest";
import {
  areSearchParamsEqual,
  buildQueryString,
  isoToLocalDateTime,
  localDateTimeToIso,
  normalizeOptionalText,
  parsePositivePage,
  setIfNonEmpty,
} from "@/lib/search-params";

describe("parsePositivePage", () => {
  it("合法正整数原样返回", () => {
    expect(parsePositivePage("3")).toBe(3);
  });

  it("null / 非整数 / 零 / 负数 / 小数 一律回落到 1", () => {
    expect(parsePositivePage(null)).toBe(1);
    expect(parsePositivePage("abc")).toBe(1);
    expect(parsePositivePage("0")).toBe(1);
    expect(parsePositivePage("-2")).toBe(1);
    expect(parsePositivePage("1.5")).toBe(1);
  });
});

describe("normalizeOptionalText", () => {
  it("null / 纯空白 → undefined，有效文本 trim 后返回", () => {
    expect(normalizeOptionalText(null)).toBeUndefined();
    expect(normalizeOptionalText("   ")).toBeUndefined();
    expect(normalizeOptionalText("  hi ")).toBe("hi");
  });
});

describe("isoToLocalDateTime / localDateTimeToIso", () => {
  it("非法输入各自安全降级（空串 / undefined）", () => {
    expect(isoToLocalDateTime(null)).toBe("");
    expect(isoToLocalDateTime("not-a-date")).toBe("");
    expect(localDateTimeToIso("")).toBeUndefined();
    expect(localDateTimeToIso("not-a-date")).toBeUndefined();
  });

  it("往返一致：ISO → 本地 datetime-local → ISO 保持同一时刻（分钟精度）", () => {
    const iso = "2026-07-02T04:30:00.000Z";
    const local = isoToLocalDateTime(iso);
    // datetime-local 形状：YYYY-MM-DDTHH:mm
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const roundTripped = localDateTimeToIso(local);
    expect(roundTripped).toBeDefined();
    expect(new Date(roundTripped ?? "").getTime()).toBe(new Date(iso).getTime());
  });
});

describe("buildQueryString / setIfNonEmpty / areSearchParamsEqual", () => {
  it("undefined 与空串字段跳过，数字转字符串", () => {
    expect(buildQueryString({ a: 1, b: "x", c: undefined, d: "" })).toBe("a=1&b=x");
  });

  it("setIfNonEmpty 忽略空白值", () => {
    const params = new URLSearchParams();
    setIfNonEmpty(params, "k", "  ");
    setIfNonEmpty(params, "k2", " v ");
    expect(params.toString()).toBe("k2=v");
  });

  it("areSearchParamsEqual 忽略键顺序", () => {
    expect(
      areSearchParamsEqual(new URLSearchParams("a=1&b=2"), new URLSearchParams("b=2&a=1")),
    ).toBe(true);
    expect(areSearchParamsEqual(new URLSearchParams("a=1"), new URLSearchParams("a=2"))).toBe(
      false,
    );
  });
});
