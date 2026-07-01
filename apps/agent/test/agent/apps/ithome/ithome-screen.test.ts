import { describe, expect, it } from "vitest";
import {
  renderIthomeArticleDetailContent,
  renderIthomeArticleListContent,
} from "../../../../src/agent/apps/ithome/ithome-screen.js";

describe("ithome-screen", () => {
  it("should render the ithome article list content", () => {
    expect(
      renderIthomeArticleListContent({
        displayName: "IT之家",
        mode: "new",
        hiddenNewCount: 3,
        articles: [
          {
            id: 11,
            title: "测试文章",
            url: "https://www.ithome.com/test",
            publishedAt: new Date("2026-03-30T04:21:03.000Z"),
            rssSummary: "这是摘要",
          },
        ],
      }),
    ).toBe(
      [
        "<system_instruction>",
        "你已进入 IT之家 资讯空间。",
        "以下是游标之后最新的一批新文章。",
        "本轮只展示最新几篇；更早的 3 篇新文章已随本次进入一起略过。",
        '如果想阅读全文，调用 invoke(tool="open_ithome_article", articleId=...)；如果想去别的 App，用 switch(id=...) 切过去。',
        "</system_instruction>",
        "<ithome_article_list>",
        "[11] 测试文章",
        "发布时间：2026/3/30 12:21",
        "链接：https://www.ithome.com/test",
        "摘要：这是摘要",
        "",
        "</ithome_article_list>",
      ].join("\n"),
    );
  });

  it("should render the ithome article detail content", () => {
    expect(
      renderIthomeArticleDetailContent({
        title: "测试文章",
        url: "https://www.ithome.com/test",
        publishedAt: new Date("2026-03-30T04:21:03.000Z"),
        content: "正文内容",
        contentSource: "rss_summary",
        truncated: true,
        maxChars: 8000,
      }),
    ).toBe(
      [
        "<system_instruction>",
        "以下是当前打开的 IT 之家文章。",
        "正文暂不可用，以下内容来自 RSS 摘要整理。",
        "正文过长，以下仅保留前 8000 字。",
        "看完后可以继续打开别的文章，或者用 switch(id=...) 去别的 App。",
        "</system_instruction>",
        "<ithome_article>",
        "标题：测试文章",
        "发布时间：2026/3/30 12:21",
        "链接：https://www.ithome.com/test",
        "",
        "正文：",
        "正文内容",
        "</ithome_article>",
      ].join("\n"),
    );
  });
});
