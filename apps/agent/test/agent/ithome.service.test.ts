import { describe, expect, it, vi } from "vitest";
import type {
  IthomeArticleDao,
  IthomeArticleListItem,
  IthomeArticleRecord,
} from "../../src/agent/capabilities/ithome/application/ithome-article.dao.js";
import type {
  IthomeFeedCursorDao,
  IthomeFeedCursorRecord,
} from "../../src/agent/capabilities/ithome/application/ithome-feed-cursor.dao.js";
import type { IthomeClient } from "../../src/agent/capabilities/ithome/application/ithome-client.js";
import { IthomeService } from "../../src/agent/capabilities/ithome/application/ithome.service.js";

describe("IthomeService", () => {
  it("should cap new article list to recentArticleLimit and advance cursor to newest shown item", async () => {
    const cursorDao = createCursorDao({
      record: {
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
    const service = new IthomeService({
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
      lastSeenArticleId: 15,
      lastSeenPublishedAt: new Date("2026-03-30T00:15:00.000Z"),
    });
  });

  it("should fall back to latest articles when there is no cursor", async () => {
    const cursorDao = createCursorDao();
    const articleDao = createArticleDao({
      listLatest: vi.fn().mockResolvedValue([createListItem(21, "最近文章")]),
    });
    const service = new IthomeService({
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
        } satisfies IthomeArticleRecord)
        .mockResolvedValueOnce({
          ...createRecord(2, "无全文"),
          articleContent: null,
          articleContentStatus: "failed",
          rssSummary: "摘要兜底",
        } satisfies IthomeArticleRecord),
    });
    const service = new IthomeService({
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

  it("should truncate on a code-point boundary so an emoji is never split into a lone surrogate", async () => {
    // 8 个 emoji（每个 2 个 UTF-16 码元）；截到 5 个码点。裸 .slice(0,5) 会切在第 3 个 emoji 中间
    // 留下半个代理项，让上游 400 掉整条请求（历史事故）。码点截断必须整段留 5 个完整 emoji。
    const articleDao = createArticleDao({
      findById: vi.fn().mockResolvedValueOnce({
        ...createRecord(1, "emoji 长文"),
        articleContent: "😀".repeat(8),
        articleContentStatus: "succeeded",
      } satisfies IthomeArticleRecord),
    });
    const service = new IthomeService({
      articleDao,
      cursorDao: createCursorDao(),
      ithomeClient: createClient(),
      recentArticleLimit: 8,
      articleMaxChars: 5,
    });

    const result = await service.openArticle({ articleId: 1 });

    expect(result?.truncated).toBe(true);
    expect(result?.content).toBe(`${"😀".repeat(5)}……`);
    // 无落单代理项：Array.from 按码点拆分，任何半个 emoji 都会破坏这个等式。
    expect(
      Array.from(result?.content ?? "").filter(
        ch => ch.length === 1 && ch >= "\ud800" && ch <= "\udfff",
      ),
    ).toEqual([]);
  });
});

function createArticleDao(overrides: Partial<IthomeArticleDao> = {}): IthomeArticleDao {
  const dao = {
    findByUpstreamId: vi.fn().mockResolvedValue(null),
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
  } as IthomeArticleDao;
}

function createCursorDao(input?: { record?: IthomeFeedCursorRecord }): IthomeFeedCursorDao {
  const dao = {
    find: vi.fn().mockResolvedValue(input?.record ?? null),
    upsert: vi.fn().mockResolvedValue(undefined),
  };

  return dao as IthomeFeedCursorDao;
}

function createClient(): IthomeClient {
  return {
    fetchFeedItems: vi.fn().mockResolvedValue([]),
    fetchArticleContent: vi.fn().mockResolvedValue(""),
  };
}

function createListItem(id: number, title: string): IthomeArticleListItem {
  return {
    id,
    title,
    url: `https://www.ithome.com/${id}.htm`,
    publishedAt: new Date(`2026-03-30T00:${String(id).padStart(2, "0")}:00.000Z`),
    rssSummary: `${title} 摘要`,
  };
}

function createRecord(id: number, title: string): IthomeArticleRecord {
  return {
    id,
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
