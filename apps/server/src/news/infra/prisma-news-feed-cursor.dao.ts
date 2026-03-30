import type { Database } from "../../db/client.js";
import type {
  NewsFeedCursorDao,
  NewsFeedCursorRecord,
} from "../application/news-feed-cursor.dao.js";

export class PrismaNewsFeedCursorDao implements NewsFeedCursorDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async findBySourceKey(input: { sourceKey: string }): Promise<NewsFeedCursorRecord | null> {
    const row = await this.database.newsFeedCursor.findUnique({
      where: {
        sourceKey: input.sourceKey,
      },
    });

    if (!row) {
      return null;
    }

    return {
      sourceKey: row.sourceKey,
      lastSeenArticleId: row.lastSeenArticleId,
      lastSeenPublishedAt: row.lastSeenPublishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public async upsert(input: {
    sourceKey: string;
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
  }): Promise<void> {
    await this.database.newsFeedCursor.upsert({
      where: {
        sourceKey: input.sourceKey,
      },
      create: {
        sourceKey: input.sourceKey,
        lastSeenArticleId: input.lastSeenArticleId,
        lastSeenPublishedAt: input.lastSeenPublishedAt,
      },
      update: {
        lastSeenArticleId: input.lastSeenArticleId,
        lastSeenPublishedAt: input.lastSeenPublishedAt,
      },
    });
  }
}
