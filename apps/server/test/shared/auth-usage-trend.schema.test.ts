import {
  AuthUsageTrendQuerySchema,
  AuthUsageTrendResponseSchema,
} from "@kagami/shared/schemas/auth-usage-trend";
import { describe, expect, it } from "vitest";

describe("auth usage trend schemas", () => {
  it("should parse trend query with default range", () => {
    const result = AuthUsageTrendQuerySchema.parse({});

    expect(result.range).toBe("24h");
  });

  it("should parse trend response", () => {
    const result = AuthUsageTrendResponseSchema.parse({
      range: "24h",
      series: [
        {
          windowKey: "five_hour",
          label: "5 小时",
          points: [
            {
              capturedAt: "2026-03-27T10:00:00.000Z",
              remainingPercent: 65,
            },
          ],
        },
        {
          windowKey: "seven_day",
          label: "7 天",
          points: [],
        },
      ],
    });

    expect(result.series[0]?.windowKey).toBe("five_hour");
    expect(result.series[0]?.points[0]?.remainingPercent).toBe(65);
  });
});
