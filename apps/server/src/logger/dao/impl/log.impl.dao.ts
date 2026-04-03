import type * as Prisma from "../../../generated/prisma/internal/prismaNamespace.js";
import { toJsonRecord, toInputJsonObject } from "../../../common/prisma-json.js";
import type { Database } from "../../../db/client.js";
import type {
  AppLogItem,
  InsertAppLogItem,
  LogDao,
  QueryAppLogListFilterInput,
  QueryAppLogListPageInput,
} from "../log.dao.js";

type PrismaLogDaoDeps = {
  database: Database;
};

export class PrismaLogDao implements LogDao {
  private readonly database: Database;

  public constructor({ database }: PrismaLogDaoDeps) {
    this.database = database;
  }

  public async insertBatch(items: InsertAppLogItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    await this.database.appLog.createMany({
      data: items.map(item => ({
        traceId: item.traceId,
        level: item.level,
        message: item.message,
        metadata: toInputJsonObject(item.metadata),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    });
  }

  public async countByQuery(input: QueryAppLogListFilterInput): Promise<number> {
    const where = buildWhereInput(input);
    return this.database.appLog.count({ where });
  }

  public async listByQueryPage(input: QueryAppLogListPageInput): Promise<AppLogItem[]> {
    const where = buildWhereInput(input);
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.database.appLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(item => ({
      id: item.id,
      traceId: item.traceId,
      level: item.level as AppLogItem["level"],
      message: item.message,
      metadata: toJsonRecord(item.metadata),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }
}

function buildWhereInput(input: QueryAppLogListFilterInput): Prisma.AppLogWhereInput {
  const where: Prisma.AppLogWhereInput = {};

  if (input.level) {
    where.level = input.level;
  }
  if (input.traceId) {
    where.traceId = input.traceId;
  }
  if (input.message) {
    where.message = {
      contains: input.message,
      mode: "insensitive",
    };
  }
  if (input.source) {
    where.metadata = {
      path: ["source"],
      string_contains: input.source,
      mode: "insensitive",
    };
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
