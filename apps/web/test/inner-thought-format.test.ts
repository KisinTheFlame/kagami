import { describe, expect, it } from "vitest";
import { formatTriggerInterval } from "@/lib/inner-thought-format";

describe("formatTriggerInterval", () => {
  it("null / NaN / 负值（缺上一条、跨页、时钟回拨）→ —", () => {
    expect(formatTriggerInterval(null)).toBe("—");
    expect(formatTriggerInterval(Number.NaN)).toBe("—");
    expect(formatTriggerInterval(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatTriggerInterval(-1000)).toBe("—");
  });

  it("<60s → +Ns（不补零）", () => {
    expect(formatTriggerInterval(0)).toBe("+0s");
    expect(formatTriggerInterval(45_000)).toBe("+45s");
    expect(formatTriggerInterval(59_000)).toBe("+59s");
    // 四舍五入到秒
    expect(formatTriggerInterval(59_400)).toBe("+59s");
  });

  it("60s 进位到分，秒补零", () => {
    expect(formatTriggerInterval(60_000)).toBe("+1m00s");
    expect(formatTriggerInterval(372_000)).toBe("+6m12s");
    expect(formatTriggerInterval(3_599_000)).toBe("+59m59s");
  });

  it(">=1h → +Hh MMm，分补零", () => {
    expect(formatTriggerInterval(3_600_000)).toBe("+1h00m");
    expect(formatTriggerInterval(3_661_000)).toBe("+1h01m");
    expect(formatTriggerInterval(9_000_000)).toBe("+2h30m");
  });
});
