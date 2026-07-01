import { describe, expect, it } from "vitest";
import { BizError } from "@kagami/server-core/common/errors/biz-error";
import { normalizeLngLat } from "../../../../src/agent/apps/amap/client/amap-coord.js";

describe("normalizeLngLat", () => {
  it("passes a valid GCJ-02 lng,lat through (trimmed)", () => {
    expect(normalizeLngLat(" 116.397463,39.909187 ")).toBe("116.397463,39.909187");
  });

  it("rounds to 6 decimals", () => {
    expect(normalizeLngLat("116.39746312,39.90918799")).toBe("116.397463,39.909188");
  });

  it("rejects empty / single-part input", () => {
    expect(() => normalizeLngLat("")).toThrow(BizError);
    expect(() => normalizeLngLat("116.397")).toThrow(BizError);
  });

  it("rejects non-numeric", () => {
    expect(() => normalizeLngLat("east,north")).toThrow(BizError);
  });

  it("rejects out-of-range (catches reversed lat,lng)", () => {
    // 39.9,116.4 → lng=39.9 ok but lat=116.4 > 90 → reversed, rejected.
    expect(() => normalizeLngLat("39.909187,116.397463")).toThrow(BizError);
  });
});
