import {
  launchPersistentContext,
  ensureBinary,
  type LaunchPersistentContextOptions,
} from "cloakbrowser";
import type { BrowserContext, Page } from "playwright-core";
import { AppLogger } from "@kagami/kernel/logger/logger";
import { BrowserError } from "../domain/errors.js";

const logger = new AppLogger({ source: "agent.browser-service" });

/**
 * BrowserService 的运行配置。只有 4 个字段来自 config（环境相关）；其余行为
 * 参数是代码常量（见下方 const），遵循 config-yaml-is-for-ops-not-code。
 */
export type BrowserServiceConfig = {
  headless: boolean;
  userDataDir: string;
  proxy?: string;
  licenseKey?: string;
};

// —— 代码常量（非环境变量，不进 config）——
const HUMANIZE = true;
const HUMAN_PRESET = "default" as const;
const VIEWPORT = { width: 1024, height: 768 };
const NAVIGATION_TIMEOUT_MS = 30_000;
/** 死等（waitFor ms）上限：防止超大 ms 永久占住串行动作队列。 */
const MAX_WAIT_MS = 30_000;
/** 单步动作超时收紧到 10s：浏览器动作阻塞单线程主循环，超时上限即 QQ 最坏延迟（T2）。 */
const ACTION_TIMEOUT_MS = 10_000;
const SCREENSHOT_JPEG_QUALITY = 85;

/** Kagami 看到的 observe 结果：带 epoch 的语义树文本。 */
export type ObserveResult = {
  epoch: number;
  url: string;
  title: string;
  /** ariaSnapshot(ai+boxes) 文本，ref 已改写成 `<epoch>:eN` 形式。 */
  snapshot: string;
};

export type ScreenshotResult = {
  image: Buffer;
  mimeType: string;
  width: number;
  height: number;
  url: string;
};

/**
 * 包 CloakBrowser（Playwright drop-in）的浏览器服务。被 BrowserApp 持有，工具经闭包取。
 *
 * - 单一持久 profile context（登录态跨重启）+ opener 页栈（接住 OAuth 弹窗）。
 * - observe 走 page.ariaSnapshot({ mode:"ai", boxes:true })：Playwright 原生给 [ref=eN] +
 *   [box=...] + iframe 内快照。点击经 locator("aria-ref=eN")。无需自建 ElementRegistry。
 * - ref 防失效：每次 observe 递增 epoch 并把 snapshot 里的 ref 改写成 `<epoch>:eN`；
 *   click/type 校验 epoch，过期即拒（STALE_REF）。
 *
 * 设计依据：仓库根 CLAUDE.md + eng-review 决策修订。
 */
export class BrowserService {
  private readonly config: BrowserServiceConfig;

  private context: BrowserContext | null = null;
  private alive = false;
  private launching: Promise<void> | null = null;
  private pageStack: Page[] = [];
  private observeEpoch = 0;
  private lastUrl: string | null = null;
  private lastTitle: string | null = null;

  public constructor({ config }: { config: BrowserServiceConfig }) {
    this.config = config;
  }

  /** onStartup 预热：只下二进制、不开窗，削掉首个 enter 的延迟。失败不抛（enter 时再降级提示）。 */
  public async prewarm(): Promise<void> {
    try {
      await ensureBinary();
    } catch (error) {
      logger.warn("CloakBrowser ensureBinary 预热失败", {
        event: "browser.prewarm.failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public async shutdown(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        // 关停尽力而为
      }
    }
    this.context = null;
    this.alive = false;
    this.pageStack = [];
  }

  // —— 生命周期：lazy-launch + 崩溃探活 ——

  private async ensureLaunched(): Promise<BrowserContext> {
    if (this.alive && this.context) {
      return this.context;
    }
    if (this.launching) {
      await this.launching;
      if (this.context) {
        return this.context;
      }
    }
    this.launching = this.launch();
    try {
      await this.launching;
    } finally {
      this.launching = null;
    }
    if (!this.context) {
      throw new BrowserError("BROWSER_NOT_READY", "浏览器启动失败");
    }
    return this.context;
  }

  private async launch(): Promise<void> {
    const options: LaunchPersistentContextOptions = {
      userDataDir: this.config.userDataDir,
      headless: this.config.headless,
      viewport: VIEWPORT,
      humanize: HUMANIZE,
      humanPreset: HUMAN_PRESET,
      ...(this.config.proxy ? { proxy: this.config.proxy } : {}),
      ...(this.config.licenseKey ? { licenseKey: this.config.licenseKey } : {}),
    };
    let context: BrowserContext;
    try {
      context = await launchPersistentContext(options);
    } catch (error) {
      throw new BrowserError(
        "BROWSER_NOT_READY",
        `浏览器启动失败（二进制/license/显示？）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.context = context;
    this.alive = true;
    this.pageStack = [];
    context.on("close", () => {
      this.alive = false;
    });
    // 多页 opener 栈：新页压栈、关闭出栈。OAuth 弹窗即新页。
    context.on("page", page => this.trackPage(page));
    for (const page of context.pages()) {
      this.trackPage(page);
    }
    if (this.pageStack.length === 0) {
      this.trackPage(await context.newPage());
    }
    logger.info("浏览器已启动", {
      event: "browser.launched",
      headless: this.config.headless,
    });
  }

  private trackPage(page: Page): void {
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    this.pageStack.push(page);
    page.on("close", () => {
      this.pageStack = this.pageStack.filter(item => item !== page);
    });
  }

  /** 当前活动页 = opener 栈顶未关闭的页；崩溃时重启并提示。 */
  private async getActivePage(): Promise<Page> {
    const context = await this.ensureLaunched();
    for (let index = this.pageStack.length - 1; index >= 0; index -= 1) {
      const page = this.pageStack[index];
      if (!page.isClosed()) {
        return page;
      }
    }
    // 栈空（全关了）：开新页，epoch 失效。
    const page = await context.newPage();
    this.trackPage(page);
    return page;
  }

  // —— 动作 ——

  public async navigate(url: string): Promise<{ url: string; title: string }> {
    const page = await this.getActivePage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    } catch (error) {
      throw new BrowserError("NAVIGATION_FAILED", `导航失败：${this.msg(error)}`, {
        url,
      });
    }
    this.lastUrl = page.url();
    this.lastTitle = await page.title().catch(() => "");
    return { url: this.lastUrl, title: this.lastTitle ?? "" };
  }

  public async observe(): Promise<ObserveResult> {
    const page = await this.getActivePage();
    let raw: string;
    try {
      raw = await page.ariaSnapshot({ mode: "ai", boxes: true });
    } catch (error) {
      throw new BrowserError("BROWSER_ERROR", `读取页面语义树失败：${this.msg(error)}`, {
        url: page.url(),
      });
    }
    this.observeEpoch += 1;
    const epoch = this.observeEpoch;
    // 把 [ref=eN] 改写成 [ref=<epoch>:eN]，让 Kagami 拿到带 epoch 的 ref。
    const snapshot = raw.replace(/\[ref=(e\d+)\]/g, `[ref=${epoch}:$1]`);
    this.lastUrl = page.url();
    this.lastTitle = await page.title().catch(() => "");
    return { epoch, url: this.lastUrl, title: this.lastTitle ?? "", snapshot };
  }

  public async click(target: string): Promise<{ url: string }> {
    const page = await this.getActivePage();
    const locator = this.resolveLocator(page, target);
    try {
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
    } catch (error) {
      throw new BrowserError("ELEMENT_NOT_ACTIONABLE", `点击失败：${this.msg(error)}`, {
        url: page.url(),
        ref: target,
        locatorState: "click",
      });
    }
    return { url: page.url() };
  }

  public async type(
    target: string,
    value: { text: string },
    submit: boolean,
  ): Promise<{ url: string }> {
    const page = await this.getActivePage();
    const locator = this.resolveLocator(page, target);
    try {
      await locator.fill(value.text, { timeout: ACTION_TIMEOUT_MS });
      if (submit) {
        await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
      }
    } catch (error) {
      throw new BrowserError("ELEMENT_NOT_ACTIONABLE", `输入失败：${this.msg(error)}`, {
        url: page.url(),
        ref: target,
        locatorState: "fill",
      });
    }
    return { url: page.url() };
  }

  public async press(key: string): Promise<void> {
    const page = await this.getActivePage();
    try {
      await page.keyboard.press(key);
    } catch (error) {
      throw new BrowserError("BROWSER_ERROR", `按键失败：${this.msg(error)}`, {
        url: page.url(),
      });
    }
  }

  public async waitFor(input: { selector?: string; ms?: number }): Promise<void> {
    const page = await this.getActivePage();
    try {
      if (typeof input.ms === "number") {
        // 死等上限：拆进程后动作走串行队列，一个超大 ms 会永久占住队尾、堵死后续所有动作。
        // 钳到 MAX_WAIT_MS（issue #173 codex 评审：SerialExecutor wedge）。
        await page.waitForTimeout(Math.min(input.ms, MAX_WAIT_MS));
      } else if (input.selector) {
        await page.locator(input.selector).first().waitFor({ timeout: ACTION_TIMEOUT_MS });
      }
    } catch (error) {
      throw new BrowserError("ACTION_TIMEOUT", `等待失败：${this.msg(error)}`, {
        url: page.url(),
      });
    }
  }

  public async screenshot(): Promise<ScreenshotResult> {
    const page = await this.getActivePage();
    // 敏感拒截：聚焦 password 字段时拒绝（避免明文进多模态上下文）。
    const focusedSensitive = await page
      .evaluate(() => {
        const el = document.activeElement as HTMLInputElement | null;
        return Boolean(el && el.tagName === "INPUT" && el.type === "password");
      })
      .catch(() => false);
    if (focusedSensitive) {
      throw new BrowserError(
        "SCREENSHOT_REFUSED",
        "当前聚焦在密码字段，拒绝截图以免明文进上下文。先点别处再截。",
        { url: page.url() },
      );
    }
    let image: Buffer;
    try {
      image = await page.screenshot({
        type: "jpeg",
        quality: SCREENSHOT_JPEG_QUALITY,
        fullPage: false,
      });
    } catch (error) {
      throw new BrowserError("BROWSER_ERROR", `截图失败：${this.msg(error)}`, {
        url: page.url(),
      });
    }
    return {
      image,
      mimeType: "image/jpeg",
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      url: page.url(),
    };
  }

  /** 全权 eval（用户决定：不限制读写，明示逃生舷）。返回值 JSON 化后截断。 */
  public async evaluate(script: string): Promise<string> {
    const page = await this.getActivePage();
    try {
      const result: unknown = await page.evaluate(script);
      const serialized = typeof result === "string" ? result : JSON.stringify(result ?? null);
      return serialized.length > 4096 ? `${serialized.slice(0, 4096)}…(截断)` : serialized;
    } catch (error) {
      throw new BrowserError("EVAL_FAILED", `eval 失败：${this.msg(error)}`, {
        url: page.url(),
      });
    }
  }

  // —— 状态持久化（跨重启续上"我刚在看哪"；不自动 navigate）——

  public exportState(): { lastUrl: string | null; lastTitle: string | null } {
    return { lastUrl: this.lastUrl, lastTitle: this.lastTitle };
  }

  public restoreState(state: { lastUrl: string | null; lastTitle: string | null }): void {
    this.lastUrl = state.lastUrl;
    this.lastTitle = state.lastTitle;
  }

  public getLastLocation(): { lastUrl: string | null; lastTitle: string | null } {
    return { lastUrl: this.lastUrl, lastTitle: this.lastTitle };
  }

  // —— 内部 ——

  /**
   * 把 Kagami 给的 target 解析成 Playwright locator。
   * - 形如 `<epoch>:eN` → aria-ref（校验 epoch，过期即拒）。
   * - 其他 → 当文本，getByText 取首个匹配。
   */
  private resolveLocator(page: Page, target: string) {
    const refMatch = /^(\d+):(e\d+)$/.exec(target.trim());
    if (refMatch) {
      const epoch = Number(refMatch[1]);
      const rawRef = refMatch[2];
      if (epoch !== this.observeEpoch) {
        throw new BrowserError(
          "STALE_REF",
          `ref 来自旧的 observe（epoch ${epoch}，当前 ${this.observeEpoch}），请先重新 observe 再操作。`,
          { ref: target, epoch, currentEpoch: this.observeEpoch },
        );
      }
      return page.locator(`aria-ref=${rawRef}`);
    }
    return page.getByText(target, { exact: false }).first();
  }

  private msg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
