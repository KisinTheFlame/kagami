import type { App } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { renderIthomeArticleListContent } from "./ithome-screen.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import type { IthomeService } from "../../capabilities/ithome/application/ithome.service.js";
import { OpenIthomeArticleTool } from "./tools/open-ithome-article.tool.js";

export const ITHOME_APP_ID = "ithome";

type IthomeAppDeps = {
  ithomeService: IthomeService;
};

/**
 * IT 之家 App。把 ithome capability 的 IthomeService 包装成 Kagami 桌面上的一个
 * 能力单元。
 *
 * - 工具：open_ithome_article(articleId)
 * - 共享 service：IthomeService 由 factory 装配（poller 也用同一个实例），
 *   不归 App own，App 只持引用、通过闭包注入工具
 * - onFocus 调 service.enterFeed 拉文章列表，产 append_message Effect 把列表
 *   渲染追加到上下文尾部
 * - 不带 configSchema：ithome 的轮询配置（pollIntervalMs / recentArticleLimit /
 *   articleMaxChars）属于 ithome capability（poller 用），不归 App 配置
 */
export class IthomeApp implements App {
  public readonly id = ITHOME_APP_ID;
  public readonly displayName = "IT之家";
  public readonly description = "浏览 IT 之家文章列表，打开读全文。";
  public readonly tools: readonly OpenIthomeArticleTool[];

  private readonly ithomeService: IthomeService;

  public constructor({ ithomeService }: IthomeAppDeps) {
    this.ithomeService = ithomeService;
    this.tools = [new OpenIthomeArticleTool({ getIthomeService: () => this.ithomeService })];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return renderServerStaticTemplate(import.meta.url, "prompts/ithome-app-help.hbs");
  }

  /**
   * 进入 App 时拉取文章列表，把渲染好的 markdown 作为 append_message Effect
   * 返出。SwitchTool 会在 switch_app 之后展开这个返回值，喂给 Interpreter。
   */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    const result = await this.ithomeService.enterFeed();
    const content = renderIthomeArticleListContent({
      displayName: result.displayName,
      mode: result.mode,
      hiddenNewCount: result.hiddenNewCount,
      articles: result.articles,
    });
    return [{ type: "append_message", content }];
  }
}
