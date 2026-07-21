import { describe, expect, it } from "vitest";
import { CalcApp } from "../../../src/agent/apps/calc/calc.app.js";
import { ClockApp } from "../../../src/agent/apps/clock/clock.app.js";
import { HnApp } from "../../../src/agent/apps/hn/hn.app.js";
import { AmapApp } from "../../../src/agent/apps/amap/amap.app.js";
import { BrowserApp } from "../../../src/agent/apps/browser/browser.app.js";
import { SpireApp } from "../../../src/agent/apps/spire/spire.app.js";
import type { BrowserClient } from "../../../src/acl/browser-client.js";
import type { SpireClient } from "../../../src/acl/spire-client.js";
import type { RootAgentEffect } from "../../../src/agent/runtime/effect/root-agent-effect.js";

/**
 * App help / portal 模板的职责分界回归锁（issue #262）：
 * - portal（onFocus 屏）只做「这是什么地方」的定位散文——不含子工具清单、不含
 *   switch / help 导航指引（switch 首进已自动附 <app_help>，见 switch.tool.ts）。
 * - help 是子工具清单与用法要点的唯一来源，保留 switch 指引。
 * calc / clock 无 onFocus，其 help 仍锁逐字输出（含变量插值与条件分支）。
 * 改模板文案时应连带更新这里的期望值。
 */

const BROWSER_TOOLS = [
  "browser_navigate",
  "browser_observe",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_wait_for",
  "browser_screenshot",
  "browser_eval",
];

const SPIRE_TOOLS = ["start_run", "play_card", "end_turn", "choose", "look", "lookup"];

const AMAP_TOOLS = [
  "geocode",
  "regeocode",
  "search_poi",
  "search_around",
  "plan_route",
  "plan_transit",
  "weather",
  "static_map",
];

const HN_TOOLS = ["glance_hn", "search_hn", "open_hn_thread", "open_hn_user"];

function appendedContent(effects: readonly RootAgentEffect[]): string {
  expect(effects).toHaveLength(1);
  const effect = effects[0] as { type: "append_message"; content: string };
  expect(effect.type).toBe("append_message");
  return effect.content;
}

/** portal 定位屏公共断言：无子工具清单、无任一工具名、无 switch/help 导航指引。 */
function expectPortalIsPureIntro(content: string, toolNames: readonly string[]): void {
  expect(content).not.toContain("可调用工具");
  expect(content).not.toContain("switch");
  expect(content).not.toContain("help");
  for (const name of toolNames) {
    expect(content).not.toContain(name);
  }
}

function stubBrowserApp(): BrowserApp {
  const browserClient = {
    getLocation: async () => {
      throw new Error("browser process down");
    },
  } as unknown as BrowserClient;
  return new BrowserApp({ browserClient });
}

function stubSpireApp(): SpireApp {
  return new SpireApp({ spireClient: {} as unknown as SpireClient });
}

async function startedAmapApp(apiKey: string): Promise<AmapApp> {
  const app = new AmapApp();
  await app.onStartup({ config: app.configSchema.parse({ apiKey }) });
  return app;
}

describe("calc / clock — help 逐字锁（无 onFocus，本就只靠 help）", () => {
  it("calc：无 precision 配置走浮点直返分支", async () => {
    const app = new CalcApp();
    expect(await app.help()).toBe(
      [
        "你在 calc App 里。当前可调用工具：",
        "  - calculate(a, op, b): 对两个有限实数做一次二元四则运算。op 取值: +, -, *, /",
        "  结果不做小数位截断（按 JS 浮点直接返回）。",
        "",
        "需要复合运算（例如 1 + 2 * 3）时，按运算优先级分多次调用：",
        '  1. calculate(a=2, op="*", b=3) → 6',
        '  2. calculate(a=1, op="+", b=6) → 7',
        "",
        "要去别的 App，用 switch(id=...) 切过去。",
      ].join("\n"),
    );
  });

  it("calc：配置 precision 后插值进小数位说明", async () => {
    const app = new CalcApp();
    await app.onStartup({ config: { precision: 2 } });
    expect(await app.help()).toContain("  结果保留 2 位小数。");
  });

  it("clock：静态 help", async () => {
    const app = new ClockApp();
    expect(await app.help()).toBe(
      [
        "你在时钟 App 里。当前可调用工具：",
        "  - view_time(): 查看当前北京时间（精确到秒）。",
        "",
        "要去别的 App，用 switch(id=...) 切过去。",
      ].join("\n"),
    );
  });
});

describe("portal 定位屏 — 不含子工具清单与导航指引", () => {
  it("hn：portal 只剩定位散文", async () => {
    const content = appendedContent(await new HnApp().onFocus());
    expect(content.startsWith("<hn_portal>")).toBe(true);
    expect(content).toContain("你进了 Hacker News。这里没有未读提醒——想看才看。");
    expect(content.endsWith("</hn_portal>")).toBe(true);
    expectPortalIsPureIntro(content, HN_TOOLS);
  });

  it("browser：portal 只剩定位散文", async () => {
    const content = appendedContent(await stubBrowserApp().onFocus());
    expect(content.startsWith("<browser_portal>")).toBe(true);
    expect(content).toContain("你进了浏览器。");
    expectPortalIsPureIntro(content, BROWSER_TOOLS);
  });

  it("spire：portal 缩到定位散文，≤ 2 句", async () => {
    const content = appendedContent(await stubSpireApp().onFocus());
    expect(content.startsWith("<spire_portal>")).toBe(true);
    expect(content).toContain("你进了杀戮尖塔");
    expect(content).not.toContain("玩法");
    expectPortalIsPureIntro(content, SPIRE_TOOLS);
    const body = content.replace(/<\/?spire_portal>/g, "").trim();
    const sentences = body.split(/[。！？]/).filter(s => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(2);
  });

  it("amap（已配置）：portal 只剩定位散文", async () => {
    const app = await startedAmapApp("K");
    const content = appendedContent(await app.onFocus());
    expect(content.startsWith("<amap_portal>")).toBe(true);
    expect(content).toContain("你进了高德地图。");
    expectPortalIsPureIntro(content, AMAP_TOOLS);
    expect(content).not.toContain("GCJ-02");
  });

  it("amap（未配置 key）：portal 给未配置提示，同样无导航指引", async () => {
    const app = await startedAmapApp("");
    const content = appendedContent(await app.onFocus());
    expect(content).toContain("你进了高德地图，但它还没配置 key，暂时不能用。");
    expectPortalIsPureIntro(content, AMAP_TOOLS);
  });
});

describe("help — 子工具清单的唯一来源，保留 switch 指引", () => {
  it("browser：help 披露全部 8 个工具与用法要点", async () => {
    const help = await stubBrowserApp().help();
    for (const name of BROWSER_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("填输入框");
    expect(help).toContain("switch");
  });

  it("browser：无位置时降级为「还没打开过页面」", async () => {
    expect(await stubBrowserApp().help()).toContain("你在浏览器 App 里。还没打开过页面。");
  });

  it("browser：有位置时插值 lastTitle/lastUrl（title 为 null 渲染成空串）", async () => {
    const browserClient = {
      getLocation: async () => ({ lastUrl: "https://example.com", lastTitle: null }),
    } as unknown as BrowserClient;
    const app = new BrowserApp({ browserClient });
    expect(await app.help()).toContain("你在浏览器 App 里。上次你在：（https://example.com）");
  });

  it("spire：help 披露全部 6 个工具与玩法段，且与 onFocus 屏不再相同", async () => {
    const app = stubSpireApp();
    const help = await app.help();
    for (const name of SPIRE_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("玩法");
    expect(help).toContain("每次动作后都会返回最新战况");
    expect(help).toContain("switch");
    expect(help).not.toBe(appendedContent(await app.onFocus()));
  });

  it("amap（已配置）：help 披露全部 8 个工具与 GCJ-02 要点", async () => {
    const help = await (await startedAmapApp("K")).help();
    for (const name of AMAP_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("GCJ-02");
    expect(help).toContain("switch");
  });

  it("amap（未配置 key）：help 与 onFocus 都渲染未配置提示屏", async () => {
    const app = await startedAmapApp("");
    const helpText = await app.help();
    expect(helpText).toContain("你进了高德地图，但它还没配置 key，暂时不能用。");
    expect(appendedContent(await app.onFocus())).toBe(helpText);
  });

  it("hn：help 披露全部 4 个工具", async () => {
    const help = await new HnApp().help();
    for (const name of HN_TOOLS) {
      expect(help).toContain(name);
    }
    expect(help).toContain("switch");
  });
});
