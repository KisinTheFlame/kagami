import { describe, expect, it, vi } from "vitest";
import { GbaApp } from "../../../../src/agent/apps/gba/gba.app.js";
import type { GbaClient } from "../../../../src/acl/gba-client.js";
import type { RootAgentEffect } from "../../../../src/agent/runtime/effect/root-agent-effect.js";
import { initTestLoggerRuntime } from "../../../helpers/logger.js";

initTestLoggerRuntime();

const GBA_TOOLS = [
  "list_games",
  "load_game",
  "press",
  "press_sequence",
  "screenshot",
  "import_rom",
];

function createClient(): GbaClient {
  return {
    setForeground: vi.fn().mockResolvedValue({ foreground: true }),
  } as unknown as GbaClient;
}

describe("GbaApp", () => {
  it("装配 6 个子工具", () => {
    const app = new GbaApp({ gbaClient: createClient() });
    expect(app.tools.map(t => t.name).sort()).toEqual([...GBA_TOOLS].sort());
  });

  it("help 披露全部工具与操作节奏", async () => {
    const help = await new GbaApp({ gbaClient: createClient() }).help();
    for (const name of GBA_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("实时运行");
    expect(help).toContain("switch");
  });

  it("onFocus=拿起(前台)+纯定位屏;onBlur=放下(后台)", async () => {
    const client = createClient();
    const app = new GbaApp({ gbaClient: client });
    const effects = await app.onFocus();
    expect(client.setForeground).toHaveBeenCalledWith(true);
    expect(effects).toHaveLength(1);
    const effect = effects[0] as Extract<RootAgentEffect, { type: "append_message" }>;
    expect(effect.content.startsWith("<gba_portal>")).toBe(true);
    for (const name of GBA_TOOLS) {
      expect(effect.content).not.toContain(name);
    }

    await app.onBlur();
    expect(client.setForeground).toHaveBeenLastCalledWith(false);
  });

  it("启停对账(review P1):onStartup/onShutdown 均转后台;服务挂了不抛", async () => {
    const client = createClient();
    const app = new GbaApp({ gbaClient: client });
    await app.onStartup();
    expect(client.setForeground).toHaveBeenLastCalledWith(false);
    await app.onShutdown();
    expect(client.setForeground).toHaveBeenLastCalledWith(false);

    const broken = {
      setForeground: vi.fn().mockRejectedValue(new Error("连接失败")),
    } as unknown as GbaClient;
    const brokenApp = new GbaApp({ gbaClient: broken });
    await expect(brokenApp.onStartup()).resolves.toBeUndefined();
    await expect(brokenApp.onFocus()).resolves.toHaveLength(1); // 服务挂了照样能进
    await expect(brokenApp.onShutdown()).resolves.toBeUndefined();
  });
});
