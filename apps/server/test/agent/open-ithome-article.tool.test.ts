import { describe, expect, it } from "vitest";
import {
  OpenIthomeArticleTool,
  OPEN_ITHOME_ARTICLE_TOOL_NAME,
} from "../../src/agent/capabilities/news/tools/open-ithome-article.tool.js";

describe("open_ithome_article tool", () => {
  it("should delegate to root agent session", async () => {
    const tool = new OpenIthomeArticleTool();
    const result = await tool.execute(
      {
        articleId: 123,
      },
      {
        rootAgentSession: {
          openIthomeArticle: async (input: { articleId: number }) => ({
            ok: true,
            ...input,
          }),
        },
      } as Parameters<typeof tool.execute>[1],
    );

    expect(tool.name).toBe(OPEN_ITHOME_ARTICLE_TOOL_NAME);
    expect(result.signal).toBe("continue");
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      articleId: 123,
    });
  });
});
