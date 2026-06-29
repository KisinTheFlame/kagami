import { renderServerStaticTemplate } from "@kagami/server-core/common/runtime/read-static-text";

// === IT之家 App 屏幕渲染 ===
// 文章列表 / 详情渲染成 <ithome_*> 段落，经 append_message Effect 追加到上下文尾部。

const BEIJING_TIME_ZONE = "Asia/Shanghai";

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
      ...article,
      publishedAtText: formatDateTime(article.publishedAt),
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
    publishedAtText: formatDateTime(input.publishedAt),
    content: input.content.trim(),
    fallbackToSummary: input.contentSource === "rss_summary",
    truncated: input.truncated,
    maxChars: input.maxChars,
  });
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}
