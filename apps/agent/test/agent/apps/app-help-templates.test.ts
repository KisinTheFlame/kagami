import { describe, expect, it } from "vitest";
import { CalcApp } from "../../../src/agent/apps/calc/calc.app.js";
import { ClockApp } from "../../../src/agent/apps/clock/clock.app.js";
import { HnApp } from "../../../src/agent/apps/hn/hn.app.js";
import { AmapApp } from "../../../src/agent/apps/amap/amap.app.js";
import { BrowserApp } from "../../../src/agent/apps/browser/browser.app.js";
import type { BrowserClient } from "../../../src/browser/browser-client.js";

/**
 * help()/portal 散文迁 static/*.hbs 模板的回归锁：断言渲染输出与迁移前的内联文案
 * 逐字一致（含变量插值与条件分支）。改模板文案时应连带更新这里的期望值。
 */
describe("App help 模板迁移 — 渲染输出与原内联文案逐字一致", () => {
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

  it("hn：help 与 onFocus portal 各自完整渲染", async () => {
    const app = new HnApp();
    expect(await app.help()).toContain("你在 Hacker News App 里。");
    const effects = await app.onFocus();
    expect(effects).toHaveLength(1);
    const content = (effects[0] as { type: "append_message"; content: string }).content;
    expect(content.startsWith("<hn_portal>")).toBe(true);
    expect(content).toContain("你进了 Hacker News。这里没有未读提醒——想看才看。");
    expect(content.endsWith("</hn_portal>")).toBe(true);
  });

  it("browser：无位置时降级为「还没打开过页面」", async () => {
    const browserClient = {
      getLocation: async () => {
        throw new Error("browser process down");
      },
    } as unknown as BrowserClient;
    const app = new BrowserApp({ browserClient });
    expect(await app.help()).toContain("你在浏览器 App 里。还没打开过页面。");
  });

  it("browser：有位置时插值 lastTitle/lastUrl（title 为 null 渲染成空串）", async () => {
    const browserClient = {
      getLocation: async () => ({ lastUrl: "https://example.com", lastTitle: null }),
    } as unknown as BrowserClient;
    const app = new BrowserApp({ browserClient });
    expect(await app.help()).toContain("你在浏览器 App 里。上次你在：（https://example.com）");
  });

  it("amap：未配置 key 时 help 与 onFocus 都渲染未配置提示屏", async () => {
    const app = new AmapApp();
    const helpText = await app.help();
    expect(helpText).toContain("你进了高德地图，但它还没配置 key，暂时不能用。");
    const effects = await app.onFocus();
    expect((effects[0] as { type: "append_message"; content: string }).content).toBe(helpText);
  });
});
