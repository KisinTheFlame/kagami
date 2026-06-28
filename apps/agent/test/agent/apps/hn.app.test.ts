import { afterEach, describe, expect, it, vi } from "vitest";
import { AppManager, createAppSubtoolOwner } from "@kagami/agent-runtime";
import { HnApp } from "../../../src/agent/apps/hn/hn.app.js";
import { InvokeTool } from "../../../src/agent/runtime/root-agent/tools/invoke.tool.js";

const EXPECTED_TOOL_NAMES = ["glance_hn", "open_hn_thread", "search_hn", "open_hn_user"];

describe("HnApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("contributes exactly the 4 expected sub-tools", () => {
    const app = new HnApp();
    expect(app.tools.map(t => t.name).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("help() lists all 4 tools and the exit instruction", async () => {
    const help = await new HnApp().help();
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(help).toContain(name);
    }
    expect(help).toContain("back_to_portal");
  });

  it("onFocus returns a static screen with NO network call (can't fail on enter)", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("onFocus must not touch the network");
    });
    vi.stubGlobal("fetch", fetchMock);
    const effects = await new HnApp().onFocus();
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ type: "append_message" });
    expect((effects[0] as { content: string }).content).toContain("Hacker News");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("configSchema accepts empty config and rejects invalid values", () => {
    const app = new HnApp();
    expect(app.configSchema.safeParse({}).success).toBe(true);
    expect(app.configSchema.safeParse({ fetchTimeoutMs: -1 }).success).toBe(false);
  });

  it("a tool fails gracefully (does not throw) before onStartup", async () => {
    const app = new HnApp();
    const glance = app.tools.find(t => t.name === "glance_hn")!;
    const result = await glance.execute({ feed: "top" }, {});
    expect(result.content).toContain("onStartup");
  });

  it("works after onStartup builds the service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [],
      }),
    );
    const app = new HnApp();
    await app.onStartup({ config: app.configSchema.parse({}) });
    const glance = app.tools.find(t => t.name === "glance_hn")!;
    const result = await glance.execute({ feed: "top" }, {});
    expect(result.content).toContain('"ok":true');
  });

  it("KV: registering HnApp does NOT change the top-level invoke tool schema", () => {
    const withHn = new AppManager();
    withHn.register(new HnApp());
    const invokeWithHn = new InvokeTool({
      owners: [createAppSubtoolOwner({ appManager: withHn, getCurrentApp: () => undefined })],
    });
    const invokeEmpty = new InvokeTool({
      owners: [
        createAppSubtoolOwner({ appManager: new AppManager(), getCurrentApp: () => undefined }),
      ],
    });
    // 顶层 invoke 工具的 LLM 定义是稳定壳，子工具清单不进它的 schema → KV 前缀不漂移。
    expect(JSON.stringify(invokeWithHn.llmTool)).toBe(JSON.stringify(invokeEmpty.llmTool));
  });
});
