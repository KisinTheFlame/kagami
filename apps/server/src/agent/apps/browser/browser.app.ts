import { z } from "zod";
import type { App, AppStartupContext, JsonValue } from "@kagami/agent-runtime";
import { BrowserService } from "../../capabilities/browser/application/browser.service.js";
import type { BrowserCredentialDao } from "../../capabilities/browser/application/browser-credential.dao.js";
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

export const BROWSER_APP_ID = "browser";

/**
 * BrowserApp 的配置。只 4 个环境相关字段（headless / userDataDir / proxy / licenseKey）；
 * humanize / viewport / timeout / 截图尺寸等行为参数是 BrowserService 里的代码常量，
 * 不进 config（config-yaml-is-for-ops-not-code）。
 */
const BrowserConfigSchema = z
  .object({
    headless: z.boolean().default(false),
    userDataDir: z.string().min(1).default("data/browser/default"),
    proxy: z.string().min(1).optional(),
    licenseKey: z.string().min(1).optional(),
  })
  .default({});

type BrowserConfig = z.infer<typeof BrowserConfigSchema>;

type BrowserAppDeps = {
  credentialDao: BrowserCredentialDao;
  /** 截图叠加落 OSS 用；缺省（OSS 关闭）时截图仍入上下文，只是没有 resid。 */
  ossClient?: OssClient;
};

type BrowserPersistedState = {
  version: 1;
  lastUrl: string | null;
  lastTitle: string | null;
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
 * 浏览器 App：把 capabilities/browser 的 BrowserService + 8 个工具包成 Kagami 桌面上
 * 的一个能力单元。结构照抄 TerminalApp。
 *
 * - 工具：browser_navigate / observe / click / type / press / wait_for / screenshot / eval。
 * - 自管 BrowserService：onStartup 实例化并 prewarm()（只下二进制不开窗）；首次操作
 *   lazy-launch 持久 profile context。工具经闭包从 App 拿 service。
 * - 持久化：exportState/restoreState 存「上次在哪个 url/标题」（不自动 navigate，回灌
 *   字符串让 Kagami 自己决定）。登录态靠 userDataDir 持久 context 自动续上。
 *
 * 设计依据：仓库根 CLAUDE.md + office-hours / eng-review 设计文档。
 */
export class BrowserApp implements App<BrowserConfig> {
  public readonly id = BROWSER_APP_ID;
  public readonly displayName = "浏览器";
  public readonly configSchema = BrowserConfigSchema;
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

  private readonly credentialDao: BrowserCredentialDao;
  private browserService: BrowserService | null = null;
  private pendingRestore: BrowserPersistedState | null = null;

  public constructor({ credentialDao, ossClient }: BrowserAppDeps) {
    this.credentialDao = credentialDao;
    const getBrowserService = (): BrowserService => {
      if (!this.browserService) {
        throw new Error("BrowserApp 尚未完成 onStartup，BrowserService 未就绪");
      }
      return this.browserService;
    };
    this.tools = [
      new BrowserNavigateTool({ getBrowserService }),
      new BrowserObserveTool({ getBrowserService }),
      new BrowserClickTool({ getBrowserService }),
      new BrowserTypeTool({ getBrowserService }),
      new BrowserPressTool({ getBrowserService }),
      new BrowserWaitForTool({ getBrowserService }),
      new BrowserScreenshotTool({ getBrowserService, ossClient }),
      new BrowserEvalTool({ getBrowserService }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    const location = this.browserService?.getLastLocation();
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

  public async onStartup(ctx: AppStartupContext<BrowserConfig>): Promise<void> {
    const config = ctx.config;
    this.browserService = new BrowserService({
      config: {
        headless: config.headless,
        userDataDir: config.userDataDir,
        proxy: config.proxy,
        licenseKey: config.licenseKey,
      },
      credentialDao: this.credentialDao,
    });
    if (this.pendingRestore) {
      this.browserService.restoreState({
        lastUrl: this.pendingRestore.lastUrl,
        lastTitle: this.pendingRestore.lastTitle,
      });
      this.pendingRestore = null;
    }
    await this.browserService.prewarm();
  }

  public async onShutdown(): Promise<void> {
    if (this.browserService) {
      await this.browserService.shutdown();
    }
  }

  /** 进入浏览器：只给静态提示屏，不自动开窗/拉页（无网络 I/O，永不因启动失败而进不去）。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    return [{ type: "append_message", content: BROWSER_AFFORDANCE }];
  }

  public exportState(): JsonValue {
    const location = this.browserService?.exportState() ?? { lastUrl: null, lastTitle: null };
    const state: BrowserPersistedState = {
      version: 1,
      lastUrl: location.lastUrl,
      lastTitle: location.lastTitle,
    };
    return state;
  }

  public restoreState(state: JsonValue): void {
    if (
      typeof state !== "object" ||
      state === null ||
      Array.isArray(state) ||
      (state as { version?: unknown }).version !== 1
    ) {
      return;
    }
    const typed = state as unknown as BrowserPersistedState;
    this.pendingRestore = {
      version: 1,
      lastUrl: typeof typed.lastUrl === "string" ? typed.lastUrl : null,
      lastTitle: typeof typed.lastTitle === "string" ? typed.lastTitle : null,
    };
  }
}
