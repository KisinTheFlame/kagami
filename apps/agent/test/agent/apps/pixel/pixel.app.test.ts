import { describe, expect, it } from "vitest";
import { PixelApp } from "../../../../src/agent/apps/pixel/pixel.app.js";
import type { PixelClient } from "../../../../src/acl/pixel-client.js";
import type { RootAgentEffect } from "../../../../src/agent/runtime/effect/root-agent-effect.js";

const PIXEL_TOOLS = [
  "new_canvas",
  "set_pixels",
  "fill",
  "line",
  "rect",
  "circle",
  "ellipse",
  "clear",
  "show_canvas",
  "render",
];

function stubApp(): PixelApp {
  return new PixelApp({ pixelClient: {} as unknown as PixelClient });
}

function appendedContent(effects: readonly RootAgentEffect[]): string {
  expect(effects).toHaveLength(1);
  const effect = effects[0] as { type: "append_message"; content: string };
  expect(effect.type).toBe("append_message");
  return effect.content;
}

describe("PixelApp", () => {
  it("装配 10 个子工具", () => {
    expect(
      stubApp()
        .tools.map(t => t.name)
        .sort(),
    ).toEqual([...PIXEL_TOOLS].sort());
  });

  it("help 披露全部 10 个工具 + 调色板 + switch 指引", async () => {
    const help = await stubApp().help();
    for (const name of PIXEL_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("red"); // 调色板插值。
    expect(help).toContain("switch");
  });

  it("onFocus 是纯定位屏：无子工具清单、无 switch/help 导航", async () => {
    const content = appendedContent(await stubApp().onFocus());
    expect(content.startsWith("<pixel_portal>")).toBe(true);
    expect(content).toContain("你进了像素画");
    expect(content).not.toContain("switch");
    expect(content).not.toContain("help");
    for (const name of PIXEL_TOOLS) {
      expect(content).not.toContain(name);
    }
  });
});
