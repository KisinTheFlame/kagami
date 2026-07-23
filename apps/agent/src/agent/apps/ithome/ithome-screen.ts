import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
import { formatBeijingDateTime } from "@kagami/kernel/utils/time";

// === IT之家 App 屏幕渲染 ===
// 文章列表 / 详情渲染成 <ithome_*> 段落，经 append_message Effect 追加到上下文尾部。

type IthomeArticleListInput = {
  displayName: string;
  mode: "latest" | "new";
  hiddenNewCount: number;
  articles: Array<{
    id: number;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
  }>;
};

export function renderIthomeArticleListContent(input: IthomeArticleListInput): string {
  return renderServerStaticTemplate(import.meta.url, "context/ithome-article-list.hbs", {
    displayName: input.displayName,
    isNewMode: input.mode === "new",
    hiddenNewCount: input.hiddenNewCount,
    articles: input.articles.map(article => ({
      id: article.id,
      title: article.title,
      publishedAtText: formatBeijingDateTime(article.publishedAt),
      rssSummary: article.rssSummary,
    })),
  });
}

type IthomeArticleDetailInput = {
  title: string;
  url: string;
  publishedAt: Date;
  content: string;
  contentSource: "article_content" | "rss_summary";
  truncated: boolean;
  maxChars: number;
};

export function renderIthomeArticleDetailContent(input: IthomeArticleDetailInput): string {
  return renderServerStaticTemplate(import.meta.url, "context/ithome-article-detail.hbs", {
    title: input.title,
    url: input.url,
    publishedAtText: formatBeijingDateTime(input.publishedAt),
    content: input.content.trim(),
    fallbackToSummary: input.contentSource === "rss_summary",
    truncated: input.truncated,
    maxChars: input.maxChars,
  });
}
