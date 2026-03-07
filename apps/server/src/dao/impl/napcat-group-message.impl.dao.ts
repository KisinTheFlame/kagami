import type { Prisma } from "@prisma/client";
import type { Database } from "../../db/client.js";
import type {
  InsertNapcatGroupMessageItem,
  NapcatGroupMessageDao,
  NapcatGroupMessageItem,
  QueryNapcatGroupMessageListFilterInput,
  QueryNapcatGroupMessageListPageInput,
} from "../napcat-group-message.dao.js";

type PrismaNapcatGroupMessageDaoDeps = {
  database: Database;
};

export class PrismaNapcatGroupMessageDao implements NapcatGroupMessageDao {
  private readonly database: Database;

  public constructor({ database }: PrismaNapcatGroupMessageDaoDeps) {
    this.database = database;
  }

  public async insert(item: InsertNapcatGroupMessageItem): Promise<void> {
    await this.database.napcatGroupMessage.create({
      data: {
        groupId: item.groupId,
        userId: item.userId,
        nickname: item.nickname,
        messageId: item.messageId,
        rawMessage: item.rawMessage,
        eventTime: item.eventTime,
        payload: toInputJsonObject(item.payload),
        createdAt: item.createdAt,
      },
    });
  }

  public async countByQuery(input: QueryNapcatGroupMessageListFilterInput): Promise<number> {
    const where = buildWhereInput(input);
    return this.database.napcatGroupMessage.count({ where });
  }

  public async listByQueryPage(
    input: QueryNapcatGroupMessageListPageInput,
  ): Promise<NapcatGroupMessageItem[]> {
    const where = buildWhereInput(input);
    const offset = (input.page - 1) * input.pageSize;

    const rows = await this.database.napcatGroupMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(item => ({
      id: item.id,
      groupId: item.groupId,
      userId: item.userId,
      nickname: item.nickname,
      messageId: item.messageId,
      rawMessage: item.rawMessage,
      eventTime: item.eventTime,
      payload: toJsonRecord(item.payload),
      createdAt: item.createdAt,
    }));
  }
}

function buildWhereInput(
  input: QueryNapcatGroupMessageListFilterInput,
): Prisma.NapcatGroupMessageWhereInput {
  const where: Prisma.NapcatGroupMessageWhereInput = {};

  if (input.groupId) {
    where.groupId = input.groupId;
  }
  if (input.userId) {
    where.userId = input.userId;
  }
  if (input.nickname) {
    where.nickname = {
      contains: input.nickname,
      mode: "insensitive",
    };
  }
  if (input.keyword) {
    where.rawMessage = {
      contains: input.keyword,
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
