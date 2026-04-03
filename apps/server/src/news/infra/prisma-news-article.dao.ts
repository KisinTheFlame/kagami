import type { Database } from "../../db/client.js";
import type * as Prisma from "../../generated/prisma/internal/prismaNamespace.js";
import type {
  NewsArticleDao,
  NewsArticleListItem,
  NewsArticleRecord,
  NewsArticleContentStatus,
} from "../application/news-article.dao.js";
import { toInputJsonObject, toJsonRecord } from "../../common/prisma-json.js";

export class PrismaNewsArticleDao implements NewsArticleDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async findBySourceAndUpstreamId(input: {
    sourceKey: string;
    upstreamId: string;
  }): Promise<NewsArticleRecord | null> {
    const row = await this.database.newsArticle.findUnique({
      where: {
        sourceKey_upstreamId: {
          sourceKey: input.sourceKey,
          upstreamId: input.upstreamId,
        },
      },
    });

    return row ? mapRow(row) : null;
  }

  public async findById(input: { id: number }): Promise<NewsArticleRecord | null> {
    const row = await this.database.newsArticle.findUnique({
      where: {
        id: input.id,
      },
    });

    return row ? mapRow(row) : null;
  }

  public async create(input: {
    sourceKey: string;
    upstreamId: string;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
    rssPayload: Record<string, unknown>;
  }): Promise<NewsArticleRecord> {
    const row = await this.database.newsArticle.create({
      data: {
        sourceKey: input.sourceKey,
        upstreamId: input.upstreamId,
        title: input.title,
        url: input.url,
        publishedAt: input.publishedAt,
        rssSummary: input.rssSummary,
        rssPayload: toInputJsonObject(input.rssPayload),
      },
    });

    return mapRow(row);
  }

  public async updateFeedMetadata(input: {
    id: number;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
    rssPayload: Record<string, unknown>;
  }): Promise<NewsArticleRecord> {
    const row = await this.database.newsArticle.update({
      where: {
        id: input.id,
      },
      data: {
        title: input.title,
        url: input.url,
        publishedAt: input.publishedAt,
        rssSummary: input.rssSummary,
        rssPayload: toInputJsonObject(input.rssPayload),
      },
    });

    return mapRow(row);
  }

  public async updateArticleContent(input: {
    id: number;
    articleContent: string | null;
    articleContentStatus: NewsArticleContentStatus;
    articleContentFetchedAt: Date | null;
  }): Promise<void> {
    await this.database.newsArticle.update({
      where: {
        id: input.id,
      },
      data: {
        articleContent: input.articleContent,
        articleContentStatus: input.articleContentStatus,
        articleContentFetchedAt: input.articleContentFetchedAt,
      },
    });
  }

  public async listLatest(input: {
    sourceKey: string;
    limit: number;
  }): Promise<NewsArticleListItem[]> {
    const rows = await this.database.newsArticle.findMany({
      where: {
        sourceKey: input.sourceKey,
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });

    return rows.map(mapListItem);
  }

  public async listNewerThanCursor(input: {
    sourceKey: string;
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
    limit: number;
  }): Promise<NewsArticleListItem[]> {
    const rows = await this.database.newsArticle.findMany({
      where: buildNewerThanCursorWhereInput(input),
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });

    return rows.map(mapListItem);
  }

  public async countNewerThanCursor(input: {
    sourceKey: string;
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
  }): Promise<number> {
    return this.database.newsArticle.count({
      where: buildNewerThanCursorWhereInput(input),
    });
  }
}

function buildNewerThanCursorWhereInput(input: {
  sourceKey: string;
  lastSeenArticleId: number;
  lastSeenPublishedAt: Date;
}): Prisma.NewsArticleWhereInput {
  return {
    sourceKey: input.sourceKey,
    OR: [
      {
        publishedAt: {
          gt: input.lastSeenPublishedAt,
        },
      },
      {
        publishedAt: input.lastSeenPublishedAt,
        id: {
          gt: input.lastSeenArticleId,
        },
      },
    ],
  };
}

function mapRow(row: {
  id: number;
  sourceKey: string;
  upstreamId: string;
  title: string;
  url: string;
  publishedAt: Date;
  rssSummary: string;
  rssPayload: Prisma.JsonValue;
  articleContent: string | null;
  articleContentStatus: string;
  articleContentFetchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): NewsArticleRecord {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    upstreamId: row.upstreamId,
    title: row.title,
    url: row.url,
    publishedAt: row.publishedAt,
    rssSummary: row.rssSummary,
    rssPayload: toJsonRecord(row.rssPayload),
    articleContent: row.articleContent,
    articleContentStatus: row.articleContentStatus as NewsArticleContentStatus,
    articleContentFetchedAt: row.articleContentFetchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapListItem(row: {
  id: number;
  title: string;
  url: string;
  publishedAt: Date;
  rssSummary: string;
}): NewsArticleListItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    publishedAt: row.publishedAt,
    rssSummary: row.rssSummary,
  };
}
