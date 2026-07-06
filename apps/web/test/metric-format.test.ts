import { describe, expect, it } from "vitest";
import { formatCompactNumber } from "@/components/metric/metric-format";

describe("formatCompactNumber", () => {
  it("compacts large numbers to K / M / B so narrow axes don't overflow", () => {
    expect(formatCompactNumber(1_500_000)).toBe("1.5M");
    expect(formatCompactNumber(1_435_008)).toBe("1.44M");
    expect(formatCompactNumber(12_000)).toBe("12K");
    expect(formatCompactNumber(2_500_000_000)).toBe("2.5B");
  });

  it("leaves sub-1000 values readable (latency seconds, counts, percentages)", () => {
    expect(formatCompactNumber(8.1)).toBe("8.1");
    expect(formatCompactNumber(79)).toBe("79");
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(0)).toBe("0");
  });

  it("passes non-finite / non-number through as string", () => {
    expect(formatCompactNumber(Number.NaN)).toBe("NaN");
    expect(formatCompactNumber("x")).toBe("x");
  });
});
