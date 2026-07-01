import type { Database } from "@kagami/persistence/db/client";
import type * as Prisma from "@kagami/persistence/prisma";
import type {
  IthomeArticleDao,
  IthomeArticleListItem,
  IthomeArticleRecord,
  IthomeArticleContentStatus,
} from "../application/ithome-article.dao.js";
import { toInputJsonObject, toJsonRecord } from "@kagami/persistence/common/prisma-json";

export class PrismaIthomeArticleDao implements IthomeArticleDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async findByUpstreamId(input: {
    upstreamId: string;
  }): Promise<IthomeArticleRecord | null> {
    const row = await this.database.ithomeArticle.findUnique({
      where: {
        upstreamId: input.upstreamId,
      },
    });

    return row ? mapRow(row) : null;
  }

  public async findById(input: { id: number }): Promise<IthomeArticleRecord | null> {
    const row = await this.database.ithomeArticle.findUnique({
      where: {
        id: input.id,
      },
    });

    return row ? mapRow(row) : null;
  }

  public async create(input: {
    upstreamId: string;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
    rssPayload: Record<string, unknown>;
  }): Promise<IthomeArticleRecord> {
    const row = await this.database.ithomeArticle.create({
      data: {
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
  }): Promise<IthomeArticleRecord> {
    const row = await this.database.ithomeArticle.update({
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
    articleContentStatus: IthomeArticleContentStatus;
    articleContentFetchedAt: Date | null;
  }): Promise<void> {
    await this.database.ithomeArticle.update({
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

  public async listLatest(input: { limit: number }): Promise<IthomeArticleListItem[]> {
    const rows = await this.database.ithomeArticle.findMany({
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });

    return rows.map(mapListItem);
  }

  public async listNewerThanCursor(input: {
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
    limit: number;
  }): Promise<IthomeArticleListItem[]> {
    const rows = await this.database.ithomeArticle.findMany({
      where: buildNewerThanCursorWhereInput(input),
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });

    return rows.map(mapListItem);
  }

  public async countNewerThanCursor(input: {
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
  }): Promise<number> {
    return this.database.ithomeArticle.count({
      where: buildNewerThanCursorWhereInput(input),
    });
  }
}

function buildNewerThanCursorWhereInput(input: {
  lastSeenArticleId: number;
  lastSeenPublishedAt: Date;
}): Prisma.IthomeArticleWhereInput {
  return {
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
}): IthomeArticleRecord {
  return {
    id: row.id,
    upstreamId: row.upstreamId,
    title: row.title,
    url: row.url,
    publishedAt: row.publishedAt,
    rssSummary: row.rssSummary,
    rssPayload: toJsonRecord(row.rssPayload),
    articleContent: row.articleContent,
    articleContentStatus: row.articleContentStatus as IthomeArticleContentStatus,
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
}): IthomeArticleListItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    publishedAt: row.publishedAt,
    rssSummary: row.rssSummary,
  };
}
