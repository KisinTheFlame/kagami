import type * as Prisma from "@kagami/server-core/prisma";
import { toJsonRecord, toInputJsonObject } from "@kagami/server-core/common/prisma-json";
import type { Database } from "@kagami/server-core/db/client";
import type {
  InsertNapcatEventItem,
  NapcatEventDao,
  NapcatEventItem,
  QueryNapcatEventListFilterInput,
  QueryNapcatEventListPageInput,
} from "../napcat-event.dao.js";

type PrismaNapcatEventDaoDeps = {
  database: Database;
};

export class PrismaNapcatEventDao implements NapcatEventDao {
  private readonly database: Database;

  public constructor({ database }: PrismaNapcatEventDaoDeps) {
    this.database = database;
  }

  public async insert(item: InsertNapcatEventItem): Promise<void> {
    await this.database.napcatEvent.create({
      data: {
        postType: item.postType,
        messageType: item.messageType,
        subType: item.subType,
        userId: item.userId,
        groupId: item.groupId,
        eventTime: item.eventTime,
        payload: toInputJsonObject(item.payload),
        createdAt: item.createdAt,
      },
    });
  }

  public async countByQuery(input: QueryNapcatEventListFilterInput): Promise<number> {
    const where = buildWhereInput(input);
    return this.database.napcatEvent.count({ where });
  }

  public async listByQueryPage(input: QueryNapcatEventListPageInput): Promise<NapcatEventItem[]> {
    const where = buildWhereInput(input);
    const offset = (input.page - 1) * input.pageSize;

    const rows = await this.database.napcatEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(item => ({
      id: item.id,
      postType: item.postType,
      messageType: item.messageType,
      subType: item.subType,
      userId: item.userId,
      groupId: item.groupId,
      eventTime: item.eventTime,
      payload: toJsonRecord(item.payload),
      createdAt: item.createdAt,
    }));
  }
}

function buildWhereInput(input: QueryNapcatEventListFilterInput): Prisma.NapcatEventWhereInput {
  const where: Prisma.NapcatEventWhereInput = {};

  if (input.postType) {
    where.postType = input.postType;
  }
  if (input.messageType) {
    where.messageType = input.messageType;
  }
  if (input.userId) {
    where.userId = input.userId;
  }

  const createdAt: Prisma.DateTimeFilter = {};
  if (input.startAt) {
    createdAt.gte = new Date(input.startAt);
  }
  if (input.endAt) {
    createdAt.lte = new Date(input.endAt);
  }
  if (Object.keys(createdAt).length > 0) {
    where.createdAt = createdAt;
  }

  return where;
}
