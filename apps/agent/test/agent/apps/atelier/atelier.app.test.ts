import { describe, expect, it } from "vitest";
import type { AsyncTaskManager } from "@kagami/agent-runtime";
import { AtelierApp } from "../../../../src/agent/apps/atelier/atelier.app.js";
import type { ImageClient } from "../../../../src/acl/image-client.js";
import type { RootAgentEffect } from "../../../../src/agent/runtime/effect/root-agent-effect.js";

function stubApp(): AtelierApp {
  return new AtelierApp({
    imageClient: {} as unknown as ImageClient,
    asyncTaskManager: {} as unknown as AsyncTaskManager,
  });
}

function appendedContent(effects: readonly RootAgentEffect[]): string {
  expect(effects).toHaveLength(1);
  const effect = effects[0] as { type: "append_message"; content: string };
  expect(effect.type).toBe("append_message");
  return effect.content;
}

describe("AtelierApp", () => {
  it("id/displayName + 只装配一个 generate 工具", () => {
    const app = stubApp();
    expect(app.id).toBe("atelier");
    expect(app.displayName).toBe("画室");
    expect(app.tools.map(t => t.name)).toEqual(["generate"]);
  });

  it("help 披露 generate + send_resource 交付 + switch 指引", async () => {
    const help = await stubApp().help();
    expect(help).toContain("generate");
    expect(help).toContain("send_resource");
    expect(help).toContain("switch");
  });

  it("onFocus 是纯定位屏：无工具清单、无 switch/help 导航", async () => {
    const content = appendedContent(await stubApp().onFocus());
    expect(content.startsWith("<atelier_portal>")).toBe(true);
    expect(content).toContain("你进了画室");
    expect(content).not.toContain("switch");
    expect(content).not.toContain("help");
    expect(content).not.toContain("generate");
  });
});
