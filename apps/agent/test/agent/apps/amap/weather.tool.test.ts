import { describe, expect, it, vi } from "vitest";
import { WeatherTool } from "../../../../src/agent/apps/amap/tools/weather.tool.js";
import type { AmapClient } from "../../../../src/agent/apps/amap/client/amap-client.js";

function buildTool(
  weather = vi.fn().mockResolvedValue({ kind: "base", lives: [], forecasts: [] }),
): {
  tool: WeatherTool;
  weather: ReturnType<typeof vi.fn>;
} {
  const client = { weather } as unknown as AmapClient;
  return {
    tool: new WeatherTool({ getClient: () => client, getMaxChars: () => 8000 }),
    weather,
  };
}

describe("WeatherTool adcode coercion", () => {
  it('accepts a numeric adcode (model passes 110000, not "110000") and coerces to string', async () => {
    const { tool, weather } = buildTool();
    const result = await tool.execute({ adcode: 110000 }, {});
    expect(JSON.parse(result.content).ok).toBe(true);
    expect(weather).toHaveBeenCalledWith({ adcode: "110000", kind: "base" });
  });

  it("still accepts a string adcode", async () => {
    const { tool, weather } = buildTool();
    await tool.execute({ adcode: "330100", kind: "all" }, {});
    expect(weather).toHaveBeenCalledWith({ adcode: "330100", kind: "all" });
  });
});
