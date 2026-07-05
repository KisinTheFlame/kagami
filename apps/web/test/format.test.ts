import { describe, expect, it } from "vitest";
import { formatBytes, formatDateTime, formatOptionalDateTime } from "@/lib/format";

describe("formatOptionalDateTime", () => {
  it("null / undefined / 空串 / 非法时间 → fallback（默认 —）", () => {
    expect(formatOptionalDateTime(null)).toBe("—");
    expect(formatOptionalDateTime(undefined)).toBe("—");
    expect(formatOptionalDateTime("")).toBe("—");
    expect(formatOptionalDateTime("not-a-date")).toBe("—");
  });

  it("自定义 fallback 生效", () => {
    expect(formatOptionalDateTime(null, "(无)")).toBe("(无)");
  });

  it("合法时间返回 zh-CN 格式（不比对具体时区，仅校验形状）", () => {
    const formatted = formatOptionalDateTime("2026-07-02T04:30:00.000Z");
    expect(formatted).not.toBe("—");
    // zh-CN 2 位补零：YYYY/MM/DD HH:mm:ss
    expect(formatted).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("与 formatDateTime 对同一合法输入输出一致", () => {
    const iso = "2026-07-02T04:30:00.000Z";
    expect(formatOptionalDateTime(iso)).toBe(formatDateTime(iso));
  });
});

describe("formatBytes", () => {
  it("0 / 负数 / 非有限 → 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });

  it("按 1024 进制选单位，去尾随 0", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
  });
});
