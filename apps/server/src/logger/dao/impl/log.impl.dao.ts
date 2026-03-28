import type { Prisma } from "@prisma/client";
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

function toJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  return {
    value,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInputJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const normalized = normalizeInputJsonValue(value);
  if (typeof normalized === "object" && !Array.isArray(normalized)) {
    return normalized as Prisma.InputJsonObject;
  }

  return {
    value: normalized,
  };
}

function normalizeInputJsonValue(value: unknown): Prisma.InputJsonValue {
  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (currentValue instanceof Date) {
        return currentValue.toISOString();
      }
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }
      if (typeof currentValue === "function" || typeof currentValue === "symbol") {
        return String(currentValue);
      }
      return currentValue;
    });

    if (serialized === undefined) {
      return "undefined";
    }

    const parsed = JSON.parse(serialized) as unknown;
    if (parsed === null) {
      return "null";
    }

    return parsed as Prisma.InputJsonValue;
  } catch {
    if (value instanceof Error) {
      return value.message;
    }

    return String(value);
  }
}
