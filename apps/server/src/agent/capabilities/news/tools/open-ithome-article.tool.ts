import { z } from "zod";
import { ZodToolComponent, type ToolContext, type ToolKind } from "@kagami/agent-runtime";
import type { RootAgentSessionController } from "../../../runtime/root-agent/session/root-agent-session.js";

export const OPEN_ITHOME_ARTICLE_TOOL_NAME = "open_ithome_article";

const OpenIthomeArticleArgumentsSchema = z.object({
  articleId: z.number().int().positive(),
});

type OpenIthomeArticleToolContext = ToolContext & {
  rootAgentSession?: RootAgentSessionController;
};

export class OpenIthomeArticleTool extends ZodToolComponent<
  typeof OpenIthomeArticleArgumentsSchema
> {
  public readonly name = OPEN_ITHOME_ARTICLE_TOOL_NAME;
  public readonly description =
    "在 IT 之家资讯空间里打开一篇文章的全文视图，只能在 ithome 状态下调用。";
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

  protected async executeTyped(
    input: z.infer<typeof OpenIthomeArticleArgumentsSchema>,
    context: ToolContext,
  ): Promise<string> {
    const rootAgentSession = (context as OpenIthomeArticleToolContext).rootAgentSession;
    if (!rootAgentSession) {
      return JSON.stringify({
        ok: false,
        error: "SESSION_UNAVAILABLE",
      });
    }

    return JSON.stringify(
      await rootAgentSession.openIthomeArticle({
        articleId: input.articleId,
      }),
    );
  }
}
