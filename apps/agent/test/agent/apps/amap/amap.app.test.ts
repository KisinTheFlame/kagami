import { describe, expect, it, vi } from "vitest";
import { AmapApp } from "../../../../src/agent/apps/amap/amap.app.js";

const EXPECTED_TOOLS = [
  "geocode",
  "regeocode",
  "search_poi",
  "search_around",
  "plan_route",
  "plan_transit",
  "weather",
  "static_map",
];

function startedApp(apiKey: string): AmapApp {
  const app = new AmapApp();
  const config = app.configSchema.parse({ apiKey });
  void app.onStartup({ config });
  return app;
}

describe("AmapApp", () => {
  it("contributes exactly the 8 expected sub-tools", () => {
    expect(new AmapApp().tools.map(t => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("canInvoke is false without a key, true once a key is configured", () => {
    const noKey = startedApp("");
    expect(noKey.canInvoke()).toBe(false);
    const withKey = startedApp("K");
    expect(withKey.canInvoke()).toBe(true);
  });

  it("help() lists all 8 tools when configured, and says unavailable without a key", async () => {
    const help = await startedApp("K").help();
    for (const name of EXPECTED_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("back_to_portal");

    const noKeyHelp = await startedApp("").help();
    expect(noKeyHelp).toContain("没配置 key");
  });

  it("onFocus returns a static screen with NO network call", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("onFocus must not touch the network");
    });
    vi.stubGlobal("fetch", fetchMock);
    const effects = await startedApp("K").onFocus();
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ type: "append_message" });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("configSchema accepts empty config and rejects invalid values", () => {
    const app = new AmapApp();
    expect(app.configSchema.safeParse({}).success).toBe(true);
    expect(app.configSchema.safeParse({}).data?.apiKey).toBe("");
    expect(app.configSchema.safeParse({ fetchTimeoutMs: -1 }).success).toBe(false);
    expect(app.configSchema.safeParse({ staticMapScale: 3 }).success).toBe(false);
  });

  it("a tool fails gracefully (does not throw) when no key / not started", async () => {
    const app = new AmapApp();
    const geocode = app.tools.find(t => t.name === "geocode")!;
    const result = await geocode.execute({ address: "x" }, {});
    // base catches the thrown "client not ready" error into a structured tool_result.
    expect(result.content).toContain("ok");
    expect(JSON.parse(result.content).ok).toBe(false);
  });
});
