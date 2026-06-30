import type { App } from "@kagami/agent-runtime";
import { BrowserNavigateTool } from "../../capabilities/browser/tools/navigate.tool.js";
import { BrowserObserveTool } from "../../capabilities/browser/tools/observe.tool.js";
import { BrowserClickTool } from "../../capabilities/browser/tools/click.tool.js";
import { BrowserTypeTool } from "../../capabilities/browser/tools/type.tool.js";
import { BrowserPressTool } from "../../capabilities/browser/tools/press.tool.js";
import { BrowserWaitForTool } from "../../capabilities/browser/tools/wait-for.tool.js";
import { BrowserScreenshotTool } from "../../capabilities/browser/tools/screenshot.tool.js";
import { BrowserEvalTool } from "../../capabilities/browser/tools/eval.tool.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../oss/oss-client.js";
import type { BrowserClient } from "../../../browser/browser-client.js";

export const BROWSER_APP_ID = "browser";

type BrowserAppDeps = {
  /** 浏览器动作客户端：打到独立的 kagami-browser 进程（issue #173）。 */
  browserClient: BrowserClient;
  /** 截图叠加落 OSS 用；缺省（OSS 关闭）时截图仍入上下文，只是没有 resid。 */
  ossClient?: OssClient;
};

const BROWSER_AFFORDANCE = [
  "<browser_portal>",
  "你进了浏览器。这里是你上网的身体——能像人一样登录、点、填、读真实网站。",
  "可调用工具：",
  "  - browser_navigate(url)：打开网址。",
  "  - browser_observe()：读当前页语义树（带可点元素 ref + box，含 iframe）。要操作先 observe。",
  "  - browser_click(target)：点元素（ref 形如 7:e3，或一段可见文本）。",
  "  - browser_type(ref, text|secret_handle, submit?)：填输入框；密码走 secret_handle（你看不到明文）。",
  "  - browser_press(key) / browser_wait_for(selector|ms)：按键 / 等页面稳定。",
  "  - browser_screenshot()：截图原图直接进你上下文（observe 够用就别频繁截）。",
  "  - browser_eval(script)：在页面跑任意 JS 的逃生舷，谨慎用。",
  "登录态跨重启留存。调 back_to_portal 退出回桌面。",
  "</browser_portal>",
].join("\n");

/**
 * 浏览器 App：把浏览器的 8 个工具包成 Kagami 桌面上的一个能力单元。结构照抄 TerminalApp。
 *
 * 拆进程后（issue #173）：本 App 不再持有 BrowserService / 不再 launch 或杀浏览器，
 * 只持有一个打到独立 kagami-browser 进程的 HttpBrowserClient。浏览器进程有自己的 PM2
 * 生命周期，agent 重启不影响它——这是「重启不杀浏览器」的根。
 *
 * - 工具：browser_navigate / observe / click / type / press / wait_for / screenshot / eval。
 * - 无生命周期钩子：不 onStartup 建 service、不 onShutdown 杀浏览器；live 状态（当前页 /
 *   epoch / 登录态）由浏览器进程独占，本进程不持久化（exportState/restoreState 省略）。
 * - help() 经 client 的 GET /location 实时问「上次在哪」；浏览器进程未就绪时不炸（降级）。
 *
 * 设计依据：仓库根 CLAUDE.md + issue #173。
 */
export class BrowserApp implements App {
  public readonly id = BROWSER_APP_ID;
  public readonly displayName = "浏览器";
  public readonly tools: readonly [
    BrowserNavigateTool,
    BrowserObserveTool,
    BrowserClickTool,
    BrowserTypeTool,
    BrowserPressTool,
    BrowserWaitForTool,
    BrowserScreenshotTool,
    BrowserEvalTool,
  ];

  private readonly browserClient: BrowserClient;

  public constructor({ browserClient, ossClient }: BrowserAppDeps) {
    this.browserClient = browserClient;
    const getBrowserClient = (): BrowserClient => this.browserClient;
    this.tools = [
      new BrowserNavigateTool({ getBrowserClient }),
      new BrowserObserveTool({ getBrowserClient }),
      new BrowserClickTool({ getBrowserClient }),
      new BrowserTypeTool({ getBrowserClient }),
      new BrowserPressTool({ getBrowserClient }),
      new BrowserWaitForTool({ getBrowserClient }),
      new BrowserScreenshotTool({ getBrowserClient, ossClient }),
      new BrowserEvalTool({ getBrowserClient }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    const location = await this.safeLocation();
    const where =
      location?.lastUrl != null
        ? `上次你在：${location.lastTitle ?? ""}（${location.lastUrl}）`
        : "还没打开过页面。";
    return [
      `你在浏览器 App 里。${where}`,
      "",
      "可调用工具：",
      "  - browser_navigate(url): 打开网址。",
      "  - browser_observe(): 读当前页语义树（含可点元素 ref + box + iframe）。操作前先 observe。",
      "  - browser_click(target): 点元素（ref 形如 7:e3，或一段可见文本）。",
      "  - browser_type(ref, text|secret_handle, secret_field?, submit?): 填输入框；密码走 secret_handle。",
      "  - browser_press(key): 按键（Enter/Tab/Escape/Control+A 等）。",
      "  - browser_wait_for(selector|ms): 等元素出现 / 死等若干毫秒。",
      "  - browser_screenshot(reason?): 截图原图进上下文（observe 够用就别频繁截）。",
      "  - browser_eval(script): 在页面跑任意 JS 的全权逃生舷，谨慎用。",
      "",
      "ref 仅最近一次 observe 的 epoch 有效，页面变了要重新 observe。登录态跨重启留存。",
      "调 back_to_portal 退出本 App 回到桌面。",
    ].join("\n");
  }

  /** 进入浏览器：只给静态提示屏，不自动开窗/拉页（无网络 I/O，永不因启动失败而进不去）。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    return [{ type: "append_message", content: BROWSER_AFFORDANCE }];
  }

  /** 取浏览器进程的当前位置；进程未就绪/不可达时返 null，让 help 降级而非报错。 */
  private async safeLocation(): Promise<{
    lastUrl: string | null;
    lastTitle: string | null;
  } | null> {
    try {
      return await this.browserClient.getLocation();
    } catch {
      return null;
    }
  }
}
