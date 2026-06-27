import { describe, expect, it } from "vitest";
import {
  InvalidTimeError,
  parseDuration,
  parseTimePoint,
} from "../../../../src/agent/capabilities/todo/application/parse-reminder-time.js";

describe("parseDuration", () => {
  it("解析各单位为毫秒", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("30m")).toBe(1_800_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("1w")).toBe(604_800_000);
  });

  it("容忍大小写与空格", () => {
    expect(parseDuration(" 2H ")).toBe(7_200_000);
  });

  it("非法输入抛 InvalidTimeError", () => {
    expect(() => parseDuration("soon")).toThrow(InvalidTimeError);
    expect(() => parseDuration("10")).toThrow(InvalidTimeError);
    expect(() => parseDuration("0m")).toThrow(InvalidTimeError);
  });
});

describe("parseTimePoint", () => {
  const now = new Date("2026-06-27T00:00:00.000Z");

  it("相对时长 → now + 时长", () => {
    expect(parseTimePoint("30m", now).toISOString()).toBe("2026-06-27T00:30:00.000Z");
  });

  it("ISO 绝对时间 → 该时刻", () => {
    expect(parseTimePoint("2026-07-01T09:00:00.000Z", now).toISOString()).toBe(
      "2026-07-01T09:00:00.000Z",
    );
  });

  it("无法解析抛 InvalidTimeError", () => {
    expect(() => parseTimePoint("下周一", now)).toThrow(InvalidTimeError);
  });
});
