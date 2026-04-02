import type { Database } from "../../../../../db/client.js";
import type { StoryRecord } from "../../domain/story.js";
import { parseStoryMarkdown } from "../../domain/story-markdown.js";
import type { StoryDao } from "../story.dao.js";

export class PrismaStoryDao implements StoryDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async create(input: {
    markdown: string;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord> {
    const row = await this.database.story.create({
      data: {
        markdown: input.markdown,
        sourceMessageSeqStart: input.sourceMessageSeqStart,
        sourceMessageSeqEnd: input.sourceMessageSeqEnd,
      },
    });

    return mapStoryRow(row);
  }

  public async update(input: {
    id: string;
    markdown: string;
    sourceMessageSeqStart: number;
    sourceMessageSeqEnd: number;
  }): Promise<StoryRecord> {
    const row = await this.database.story.update({
      where: {
        id: input.id,
      },
      data: {
        markdown: input.markdown,
        sourceMessageSeqStart: input.sourceMessageSeqStart,
        sourceMessageSeqEnd: input.sourceMessageSeqEnd,
        updatedAt: new Date(),
      },
    });

    return mapStoryRow(row);
  }

  public async findById(id: string): Promise<StoryRecord | null> {
    const row = await this.database.story.findUnique({
      where: {
        id,
      },
    });

    return row ? mapStoryRow(row) : null;
  }

  public async findManyByIds(ids: string[]): Promise<StoryRecord[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.database.story.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });

    const rowsById = new Map(rows.map(row => [row.id, mapStoryRow(row)]));
    return ids.map(id => rowsById.get(id)).filter((row): row is StoryRecord => Boolean(row));
  }

  public async countAll(): Promise<number> {
    return await this.database.story.count();
  }

  public async listPage(input: {
    page: number;
    pageSize: number;
    orderBy: "createdAtAsc" | "createdAtDesc";
  }): Promise<StoryRecord[]> {
    const rows = await this.database.story.findMany({
      orderBy: {
        createdAt: input.orderBy === "createdAtAsc" ? "asc" : "desc",
      },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    });

    return rows.map(mapStoryRow);
  }
}

function mapStoryRow(row: {
  id: string;
  markdown: string;
  sourceMessageSeqStart: number;
  sourceMessageSeqEnd: number;
  createdAt: Date;
  updatedAt: Date;
}): StoryRecord {
  return {
    id: row.id,
    markdown: row.markdown,
    content: parseStoryMarkdown(row.markdown),
    sourceMessageSeqStart: row.sourceMessageSeqStart,
    sourceMessageSeqEnd: row.sourceMessageSeqEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
