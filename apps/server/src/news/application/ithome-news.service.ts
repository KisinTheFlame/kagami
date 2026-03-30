import type { NewsArticleDao, NewsArticleListItem } from "./news-article.dao.js";
import type { NewsFeedCursorDao } from "./news-feed-cursor.dao.js";
import type { IthomeClient } from "./ithome-client.js";

const ITHOME_SOURCE_KEY = "ithome";
const ITHOME_DISPLAY_NAME = "IT之家";

export type IthomeFeedOverview = {
  sourceKey: "ithome";
  displayName: string;
  unreadCount: number;
  hasEntered: boolean;
};

export type IthomeEnterResult = {
  sourceKey: "ithome";
  displayName: string;
  mode: "latest" | "new";
  hiddenNewCount: number;
  articles: NewsArticleListItem[];
};

export type IthomeArticleDetailResult = {
  articleId: number;
  title: string;
  url: string;
  publishedAt: Date;
  content: string;
  contentSource: "article_content" | "rss_summary";
  truncated: boolean;
  maxChars: number;
};

export type IthomeSyncResult = {
  newArticles: Array<{
    articleId: number;
    title: string;
  }>;
};

export class IthomeNewsService {
  private readonly articleDao: NewsArticleDao;
  private readonly cursorDao: NewsFeedCursorDao;
  private readonly ithomeClient: IthomeClient;
  private readonly recentArticleLimit: number;
  private readonly articleMaxChars: number;

  public constructor({
    articleDao,
    cursorDao,
    ithomeClient,
    recentArticleLimit,
    articleMaxChars,
  }: {
    articleDao: NewsArticleDao;
    cursorDao: NewsFeedCursorDao;
    ithomeClient: IthomeClient;
    recentArticleLimit: number;
    articleMaxChars: number;
  }) {
    this.articleDao = articleDao;
    this.cursorDao = cursorDao;
    this.ithomeClient = ithomeClient;
    this.recentArticleLimit = recentArticleLimit;
    this.articleMaxChars = articleMaxChars;
  }

  public async getFeedOverview(): Promise<IthomeFeedOverview> {
    const cursor = await this.cursorDao.findBySourceKey({
      sourceKey: ITHOME_SOURCE_KEY,
    });
    const unreadCount = cursor
      ? await this.articleDao.countNewerThanCursor({
          sourceKey: ITHOME_SOURCE_KEY,
          lastSeenArticleId: cursor.lastSeenArticleId,
          lastSeenPublishedAt: cursor.lastSeenPublishedAt,
        })
      : await this.articleDao.countNewerThanCursor({
          sourceKey: ITHOME_SOURCE_KEY,
          lastSeenArticleId: 0,
          lastSeenPublishedAt: new Date(0),
        });

    return {
      sourceKey: ITHOME_SOURCE_KEY,
      displayName: ITHOME_DISPLAY_NAME,
      unreadCount,
      hasEntered: cursor !== null,
    };
  }

  public async syncFeed(): Promise<IthomeSyncResult> {
    const feedItems = await this.ithomeClient.fetchFeedItems();
    const newArticles: IthomeSyncResult["newArticles"] = [];

    for (const item of feedItems) {
      const existing = await this.articleDao.findBySourceAndUpstreamId({
        sourceKey: ITHOME_SOURCE_KEY,
        upstreamId: item.upstreamId,
      });

      const article = existing
        ? await this.articleDao.updateFeedMetadata({
            id: existing.id,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            rssSummary: item.rssSummary,
            rssPayload: item.payload,
          })
        : await this.articleDao.create({
            sourceKey: ITHOME_SOURCE_KEY,
            upstreamId: item.upstreamId,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            rssSummary: item.rssSummary,
            rssPayload: item.payload,
          });

      if (!existing) {
        newArticles.push({
          articleId: article.id,
          title: article.title,
        });
      }

      if (!existing || existing.articleContentStatus !== "succeeded" || !existing.articleContent) {
        await this.tryFetchAndStoreArticleContent({
          articleId: article.id,
          url: item.url,
        });
      }
    }

    return {
      newArticles,
    };
  }

  public async enterFeed(): Promise<IthomeEnterResult> {
    const cursor = await this.cursorDao.findBySourceKey({
      sourceKey: ITHOME_SOURCE_KEY,
    });

    if (!cursor) {
      const articles = await this.articleDao.listLatest({
        sourceKey: ITHOME_SOURCE_KEY,
        limit: this.recentArticleLimit,
      });
      await this.advanceCursorToNewest(articles);

      return {
        sourceKey: ITHOME_SOURCE_KEY,
        displayName: ITHOME_DISPLAY_NAME,
        mode: "latest",
        hiddenNewCount: 0,
        articles,
      };
    }

    const totalNewCount = await this.articleDao.countNewerThanCursor({
      sourceKey: ITHOME_SOURCE_KEY,
      lastSeenArticleId: cursor.lastSeenArticleId,
      lastSeenPublishedAt: cursor.lastSeenPublishedAt,
    });

    if (totalNewCount > 0) {
      const articles = await this.articleDao.listNewerThanCursor({
        sourceKey: ITHOME_SOURCE_KEY,
        lastSeenArticleId: cursor.lastSeenArticleId,
        lastSeenPublishedAt: cursor.lastSeenPublishedAt,
        limit: this.recentArticleLimit,
      });
      await this.advanceCursorToNewest(articles);

      return {
        sourceKey: ITHOME_SOURCE_KEY,
        displayName: ITHOME_DISPLAY_NAME,
        mode: "new",
        hiddenNewCount: Math.max(0, totalNewCount - articles.length),
        articles,
      };
    }

    const articles = await this.articleDao.listLatest({
      sourceKey: ITHOME_SOURCE_KEY,
      limit: this.recentArticleLimit,
    });
    await this.advanceCursorToNewest(articles);

    return {
      sourceKey: ITHOME_SOURCE_KEY,
      displayName: ITHOME_DISPLAY_NAME,
      mode: "latest",
      hiddenNewCount: 0,
      articles,
    };
  }

  public async openArticle(input: {
    articleId: number;
  }): Promise<IthomeArticleDetailResult | null> {
    const article = await this.articleDao.findById({
      id: input.articleId,
    });
    if (!article || article.sourceKey !== ITHOME_SOURCE_KEY) {
      return null;
    }

    const source = article.articleContent?.trim().length
      ? {
          content: article.articleContent,
          contentSource: "article_content" as const,
        }
      : {
          content: article.rssSummary,
          contentSource: "rss_summary" as const,
        };
    const { text, truncated } = truncateText(source.content, this.articleMaxChars);

    return {
      articleId: article.id,
      title: article.title,
      url: article.url,
      publishedAt: article.publishedAt,
      content: text,
      contentSource: source.contentSource,
      truncated,
      maxChars: this.articleMaxChars,
    };
  }

  private async tryFetchAndStoreArticleContent(input: {
    articleId: number;
    url: string;
  }): Promise<void> {
    try {
      const content = await this.ithomeClient.fetchArticleContent({
        url: input.url,
      });
      await this.articleDao.updateArticleContent({
        id: input.articleId,
        articleContent: content,
        articleContentStatus: "succeeded",
        articleContentFetchedAt: new Date(),
      });
    } catch {
      await this.articleDao.updateArticleContent({
        id: input.articleId,
        articleContent: null,
        articleContentStatus: "failed",
        articleContentFetchedAt: new Date(),
      });
    }
  }

  private async advanceCursorToNewest(articles: NewsArticleListItem[]): Promise<void> {
    const newestArticle = articles[0];
    if (!newestArticle) {
      return;
    }

    await this.cursorDao.upsert({
      sourceKey: ITHOME_SOURCE_KEY,
      lastSeenArticleId: newestArticle.id,
      lastSeenPublishedAt: newestArticle.publishedAt,
    });
  }
}

function truncateText(
  value: string,
  maxChars: number,
): {
  text: string;
  truncated: boolean;
} {
  if (value.length <= maxChars) {
    return {
      text: value,
      truncated: false,
    };
  }

  return {
    text: `${value.slice(0, maxChars).trimEnd()}……`,
    truncated: true,
  };
}
