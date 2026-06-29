import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { renderIthomeArticleDetailContent } from "../ithome-screen.js";
import type { IthomeService } from "../../../capabilities/ithome/application/ithome.service.js";
import type { RootAgentEffect } from "../../../runtime/effect/root-agent-effect.js";

export const OPEN_ITHOME_ARTICLE_TOOL_NAME = "open_ithome_article";

const OpenIthomeArticleArgumentsSchema = z.object({
  articleId: z.number().int().positive(),
});

type OpenIthomeArticleToolDeps = {
  /**
   * IthomeService 由 factory 装配后通过 IthomeApp 注入，闭包延迟取。
   * 这跟 BashTool 的 getTerminalService 一致——工具不直接持 service 实例，
   * 由所属 App 提供访问。
   */
  getIthomeService: () => IthomeService;
};

/**
 * 在 IT 之家 App 里打开一篇文章的全文视图。
 *
 * 副作用走 Effect 模型：拉到文章后产 `append_message` Effect，把渲染好的
 * markdown 详情追加到上下文尾部。tool_result content 只放"ok + 文章 meta"
 * 这种简短状态。
 */
export class OpenIthomeArticleTool extends ZodToolComponent<
  typeof OpenIthomeArticleArgumentsSchema
> {
  public readonly name = OPEN_ITHOME_ARTICLE_TOOL_NAME;
  public readonly description =
    "在 IT 之家 App 里打开一篇文章的全文视图。只能在 ithome App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      articleId: {
        type: "number",
        description: "要打开的文章 ID，来自当前 IT 之家文章列表。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = OpenIthomeArticleArgumentsSchema;

  private readonly getIthomeService: () => IthomeService;

  public constructor({ getIthomeService }: OpenIthomeArticleToolDeps) {
    super();
    this.getIthomeService = getIthomeService;
  }

  protected async executeTyped(
    input: z.infer<typeof OpenIthomeArticleArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const article = await this.getIthomeService().openArticle({
      articleId: input.articleId,
    });
    if (!article) {
      return {
        content: JSON.stringify({
          ok: false,
          error: "ARTICLE_NOT_FOUND",
          articleId: input.articleId,
          message: "当前 IT 之家列表中找不到该文章 ID。",
        }),
      };
    }

    const detailContent = renderIthomeArticleDetailContent({
      title: article.title,
      url: article.url,
      publishedAt: article.publishedAt,
      content: article.content,
      contentSource: article.contentSource,
      truncated: article.truncated,
      maxChars: article.maxChars,
    });

    const effects: RootAgentEffect[] = [{ type: "append_message", content: detailContent }];

    return {
      content: JSON.stringify({
        ok: true,
        articleId: article.articleId,
        title: article.title,
        url: article.url,
      }),
      effects,
    };
  }
}
