import type { App } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { BrowserNavigateTool } from "../../capabilities/browser/tools/navigate.tool.js";
import { BrowserObserveTool } from "../../capabilities/browser/tools/observe.tool.js";
import { BrowserClickTool } from "../../capabilities/browser/tools/click.tool.js";
import { BrowserTypeTool } from "../../capabilities/browser/tools/type.tool.js";
import { BrowserPressTool } from "../../capabilities/browser/tools/press.tool.js";
import { BrowserWaitForTool } from "../../capabilities/browser/tools/wait-for.tool.js";
import { BrowserScreenshotTool } from "../../capabilities/browser/tools/screenshot.tool.js";
import { BrowserEvalTool } from "../../capabilities/browser/tools/eval.tool.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { OssClient } from "../../../acl/oss-client.js";
import type { BrowserClient } from "../../../acl/browser-client.js";

const BROWSER_APP_ID = "browser";

type BrowserAppDeps = {
  /** 浏览器动作客户端：打到独立的 kagami-browser 进程（issue #173）。 */
  browserClient: BrowserClient;
  /** 截图叠加落 OSS 用；缺省（OSS 关闭）时截图仍入上下文，只是没有 resid。 */
  ossClient?: OssClient;
};

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
    return renderServerStaticTemplate(import.meta.url, "prompts/browser-app-help.hbs", {
      hasLocation: location?.lastUrl != null,
      lastTitle: location?.lastTitle ?? "",
      lastUrl: location?.lastUrl ?? "",
    });
  }

  /** 进入浏览器：只给静态提示屏，不自动开窗/拉页（本地模板渲染，永不因启动失败而进不去）。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    const content = renderServerStaticTemplate(import.meta.url, "prompts/browser-app-portal.hbs");
    return [{ type: "append_message", content }];
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
