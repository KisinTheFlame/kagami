import type { Database } from "../../../../db/client.js";
import type {
  IthomeFeedCursorDao,
  IthomeFeedCursorRecord,
} from "../application/ithome-feed-cursor.dao.js";

/**
 * IT 之家只有单一资讯源，游标退化为单行表。固定主键 1，find / upsert 都锚在这一行。
 */
const CURSOR_ID = 1;

export class PrismaIthomeFeedCursorDao implements IthomeFeedCursorDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async find(): Promise<IthomeFeedCursorRecord | null> {
    const row = await this.database.ithomeFeedCursor.findUnique({
      where: {
        id: CURSOR_ID,
      },
    });

    if (!row) {
      return null;
    }

    return {
      lastSeenArticleId: row.lastSeenArticleId,
      lastSeenPublishedAt: row.lastSeenPublishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public async upsert(input: {
    lastSeenArticleId: number;
    lastSeenPublishedAt: Date;
  }): Promise<void> {
    await this.database.ithomeFeedCursor.upsert({
      where: {
        id: CURSOR_ID,
      },
      create: {
        id: CURSOR_ID,
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
