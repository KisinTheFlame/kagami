import { describe, expect, it, vi } from "vitest";
import type {
  NewsArticleDao,
  NewsArticleListItem,
  NewsArticleRecord,
} from "../../src/news/application/news-article.dao.js";
import type {
  NewsFeedCursorDao,
  NewsFeedCursorRecord,
} from "../../src/news/application/news-feed-cursor.dao.js";
import type { IthomeClient } from "../../src/news/application/ithome-client.js";
import { IthomeNewsService } from "../../src/news/application/ithome-news.service.js";

describe("IthomeNewsService", () => {
  it("should cap new article list to recentArticleLimit and advance cursor to newest shown item", async () => {
    const cursorDao = createCursorDao({
      record: {
        sourceKey: "ithome",
        lastSeenArticleId: 10,
        lastSeenPublishedAt: new Date("2026-03-29T00:00:00.000Z"),
        createdAt: new Date("2026-03-29T00:00:00.000Z"),
        updatedAt: new Date("2026-03-29T00:00:00.000Z"),
      },
    });
    const articleDao = createArticleDao({
      countNewerThanCursor: vi.fn().mockResolvedValue(5),
      listNewerThanCursor: vi
        .fn()
        .mockResolvedValue([createListItem(15, "第 15 篇"), createListItem(14, "第 14 篇")]),
    });
    const service = new IthomeNewsService({
      articleDao,
      cursorDao,
      ithomeClient: createClient(),
      recentArticleLimit: 2,
      articleMaxChars: 8000,
    });

    const result = await service.enterFeed();

    expect(result.mode).toBe("new");
    expect(result.hiddenNewCount).toBe(3);
    expect(result.articles.map(article => article.id)).toEqual([15, 14]);
    expect(cursorDao.upsert).toHaveBeenCalledWith({
      sourceKey: "ithome",
      lastSeenArticleId: 15,
      lastSeenPublishedAt: new Date("2026-03-30T00:15:00.000Z"),
    });
  });

  it("should fall back to latest articles when there is no cursor", async () => {
    const cursorDao = createCursorDao();
    const articleDao = createArticleDao({
      listLatest: vi.fn().mockResolvedValue([createListItem(21, "最近文章")]),
    });
    const service = new IthomeNewsService({
      articleDao,
      cursorDao,
      ithomeClient: createClient(),
      recentArticleLimit: 8,
      articleMaxChars: 8000,
    });

    const result = await service.enterFeed();

    expect(result.mode).toBe("latest");
    expect(result.articles).toHaveLength(1);
    expect(cursorDao.upsert).toHaveBeenCalledWith({
      sourceKey: "ithome",
      lastSeenArticleId: 21,
      lastSeenPublishedAt: new Date("2026-03-30T00:21:00.000Z"),
    });
  });

  it("should truncate article content and fall back to rss summary when full text is unavailable", async () => {
    const articleDao = createArticleDao({
      findById: vi
        .fn()
        .mockResolvedValueOnce({
          ...createRecord(1, "长文"),
          articleContent: "a".repeat(9000),
          articleContentStatus: "succeeded",
        } satisfies NewsArticleRecord)
        .mockResolvedValueOnce({
          ...createRecord(2, "无全文"),
          articleContent: null,
          articleContentStatus: "failed",
          rssSummary: "摘要兜底",
        } satisfies NewsArticleRecord),
    });
    const service = new IthomeNewsService({
      articleDao,
      cursorDao: createCursorDao(),
      ithomeClient: createClient(),
      recentArticleLimit: 8,
      articleMaxChars: 8000,
    });

    const fullTextResult = await service.openArticle({ articleId: 1 });
    const fallbackResult = await service.openArticle({ articleId: 2 });

    expect(fullTextResult).toMatchObject({
      articleId: 1,
      contentSource: "article_content",
      truncated: true,
    });
    expect(fullTextResult?.content.length).toBeGreaterThan(8000);
    expect(fallbackResult).toMatchObject({
      articleId: 2,
      contentSource: "rss_summary",
      content: "摘要兜底",
      truncated: false,
    });
  });
});

function createArticleDao(overrides: Partial<NewsArticleDao> = {}): NewsArticleDao {
  const dao = {
    findBySourceAndUpstreamId: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    updateFeedMetadata: vi.fn(),
    updateArticleContent: vi.fn(),
    listLatest: vi.fn().mockResolvedValue([]),
    listNewerThanCursor: vi.fn().mockResolvedValue([]),
    countNewerThanCursor: vi.fn().mockResolvedValue(0),
  };

  return {
    ...dao,
    ...overrides,
  } as NewsArticleDao;
}

function createCursorDao(input?: { record?: NewsFeedCursorRecord }): NewsFeedCursorDao {
  const dao = {
    findBySourceKey: vi.fn().mockResolvedValue(input?.record ?? null),
    upsert: vi.fn().mockResolvedValue(undefined),
  };

  return dao as NewsFeedCursorDao;
}

function createClient(): IthomeClient {
  return {
    fetchFeedItems: vi.fn().mockResolvedValue([]),
    fetchArticleContent: vi.fn().mockResolvedValue(""),
  };
}

function createListItem(id: number, title: string): NewsArticleListItem {
  return {
    id,
    title,
    url: `https://www.ithome.com/${id}.htm`,
    publishedAt: new Date(`2026-03-30T00:${String(id).padStart(2, "0")}:00.000Z`),
    rssSummary: `${title} 摘要`,
  };
}

function createRecord(id: number, title: string): NewsArticleRecord {
  return {
    id,
    sourceKey: "ithome",
    upstreamId: `guid-${id}`,
    title,
    url: `https://www.ithome.com/${id}.htm`,
    publishedAt: new Date(`2026-03-30T00:${String(id).padStart(2, "0")}:00.000Z`),
    rssSummary: `${title} 摘要`,
    rssPayload: {},
    articleContent: `${title} 正文`,
    articleContentStatus: "succeeded",
    articleContentFetchedAt: new Date("2026-03-30T01:00:00.000Z"),
    createdAt: new Date("2026-03-30T01:00:00.000Z"),
    updatedAt: new Date("2026-03-30T01:00:00.000Z"),
  };
}
