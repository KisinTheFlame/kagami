import { describe, expect, it, vi } from "vitest";
import { OpenIthomeArticleTool } from "../../../../src/agent/apps/ithome/tools/open-ithome-article.tool.js";
import type { IthomeService } from "../../../../src/agent/capabilities/ithome/application/ithome.service.js";

function build(openArticle: IthomeService["openArticle"]) {
  return new OpenIthomeArticleTool({
    getIthomeService: () => ({ openArticle }) as unknown as IthomeService,
  });
}

describe("OpenIthomeArticleTool", () => {
  it("命中不到文章时返回自带文案的 ARTICLE_NOT_FOUND（文案由子工具拥有，非 InvokeTool 合成）", async () => {
    const tool = build(vi.fn().mockResolvedValue(null));

    const result = await tool.execute({ articleId: 99999 }, {});
    const parsed = JSON.parse(result.content);

    expect(parsed.error).toBe("ARTICLE_NOT_FOUND");
    expect(parsed.articleId).toBeUndefined();
    expect(parsed.message).toBe("当前 IT 之家列表中找不到该文章 ID。");
  });
});
