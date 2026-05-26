import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewTimeTool } from "../../../../src/agent/apps/clock/tools/view-time.tool.js";

describe("clock App / view_time tool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns Beijing time formatted to seconds", async () => {
    vi.setSystemTime(new Date("2026-05-26T15:45:12Z")); // UTC → 北京 23:45:12
    const tool = new ViewTimeTool();
    const result = await tool.execute({}, {});

    expect(JSON.parse(result.content)).toEqual({
      ok: true,
      time: "2026 年 5 月 26 日 23:45:12",
      timezone: "Asia/Shanghai",
    });
  });

  it("rolls over the date when UTC crosses midnight in Beijing", async () => {
    vi.setSystemTime(new Date("2026-05-26T16:30:00Z")); // UTC → 北京 5/27 00:30:00
    const tool = new ViewTimeTool();
    const result = await tool.execute({}, {});

    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      time: "2026 年 5 月 27 日 00:30:00",
    });
  });

  it("always reports timezone as Asia/Shanghai", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const tool = new ViewTimeTool();
    const result = await tool.execute({}, {});

    expect(JSON.parse(result.content)).toMatchObject({
      timezone: "Asia/Shanghai",
    });
  });
});
