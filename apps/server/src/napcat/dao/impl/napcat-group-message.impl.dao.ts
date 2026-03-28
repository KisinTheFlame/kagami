import { Prisma } from "@prisma/client";
import { type JsonValue } from "@kagami/shared/schemas/base";
import type { Database } from "../../../db/client.js";
import type {
  InsertNapcatGroupMessageItem,
  NapcatGroupMessageContextItem,
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

  public async insert(item: InsertNapcatGroupMessageItem): Promise<number> {
    const row = await this.database.napcatGroupMessage.create({
      data: {
        groupId: item.groupId,
        userId: item.userId,
        nickname: item.nickname,
        messageId: item.messageId,
        message: toInputJsonValue(item.message),
        eventTime: item.eventTime,
        payload: toInputJsonValue(item.payload),
        createdAt: item.createdAt,
      },
      select: {
        id: true,
      },
    });

    return row.id;
  }

  public async countByQuery(input: QueryNapcatGroupMessageListFilterInput): Promise<number> {
    if (input.keyword) {
      return this.countByKeywordQuery(input);
    }

    const where = buildWhereInput(input);
    return this.database.napcatGroupMessage.count({ where });
  }

  public async listByQueryPage(
    input: QueryNapcatGroupMessageListPageInput,
  ): Promise<NapcatGroupMessageItem[]> {
    if (input.keyword) {
      return this.listByKeywordQuery(input);
    }

    const where = buildWhereInput(input);
    const offset = (input.page - 1) * input.pageSize;

    const rows = await this.database.napcatGroupMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(mapPrismaRowToItem);
  }

  private async countByKeywordQuery(
    input: QueryNapcatGroupMessageListFilterInput,
  ): Promise<number> {
    const whereClause = buildKeywordSqlWhereClause(input);
    const rows = await this.database.$queryRaw<
      Array<{ total: bigint | number | string }>
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS "total"
      FROM "napcat_group_message"
      ${whereClause}
    `);

    return toCount(rows[0]?.total ?? 0);
  }

  private async listByKeywordQuery(
    input: QueryNapcatGroupMessageListPageInput,
  ): Promise<NapcatGroupMessageItem[]> {
    const whereClause = buildKeywordSqlWhereClause(input);
    const offset = (input.page - 1) * input.pageSize;

    const rows = await this.database.$queryRaw<RawNapcatGroupMessageRow[]>(Prisma.sql`
      SELECT
        "id" AS "id",
        "group_id" AS "groupId",
        "user_id" AS "userId",
        "nickname" AS "nickname",
        "message_id" AS "messageId",
        "message" AS "message",
        "event_time" AS "eventTime",
        "payload" AS "payload",
        "created_at" AS "createdAt"
      FROM "napcat_group_message"
      ${whereClause}
      ORDER BY "created_at" DESC, "id" DESC
      LIMIT ${input.pageSize}
      OFFSET ${offset}
    `);

    return rows.map(mapRawRowToItem);
  }

  public async listContextWindowById(input: {
    groupId: string;
    messageId: number;
    before: number;
    after: number;
  }): Promise<NapcatGroupMessageContextItem[]> {
    const rows = await this.database.$queryRaw<RawNapcatGroupMessageContextRow[]>(Prisma.sql`
      WITH ordered_messages AS (
        SELECT
          gm."id" AS "id",
          gm."group_id" AS "groupId",
          gm."user_id" AS "userId",
          gm."nickname" AS "nickname",
          COALESCE(
            NULLIF(regexp_replace(chunk."content", '^[^\n]*\n', ''), ''),
            gm."payload"->>'raw_message',
            gm."message"::text
          ) AS "messageText",
          gm."event_time" AS "eventTime",
          gm."created_at" AS "createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY gm."group_id"
            ORDER BY COALESCE(gm."event_time", gm."created_at") ASC, gm."id" ASC
          ) AS "rowNumber"
        FROM "napcat_group_message" AS gm
        LEFT JOIN "napcat_group_message_chunk" AS chunk
          ON chunk."source_message_id" = gm."id"
          AND chunk."chunk_index" = 0
        WHERE gm."group_id" = ${input.groupId}
      ),
      center_message AS (
        SELECT "rowNumber"
        FROM ordered_messages
        WHERE "id" = ${input.messageId}
      )
      SELECT
        "id",
        "groupId",
        "userId",
        "nickname",
        "messageText",
        "eventTime",
        "createdAt"
      FROM ordered_messages
      WHERE "rowNumber" BETWEEN
        (SELECT "rowNumber" - ${input.before} FROM center_message)
        AND
        (SELECT "rowNumber" + ${input.after} FROM center_message)
      ORDER BY "rowNumber" ASC
    `);

    return rows.map(mapRawContextRowToItem);
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

function buildKeywordSqlWhereClause(input: QueryNapcatGroupMessageListFilterInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (input.groupId) {
    conditions.push(Prisma.sql`"group_id" = ${input.groupId}`);
  }
  if (input.userId) {
    conditions.push(Prisma.sql`"user_id" = ${input.userId}`);
  }
  if (input.nickname) {
    conditions.push(Prisma.sql`"nickname" ILIKE ${toContainsPattern(input.nickname)}`);
  }
  if (input.keyword) {
    conditions.push(Prisma.sql`"message"::text ILIKE ${toContainsPattern(input.keyword)}`);
  }
  if (input.startAt) {
    conditions.push(Prisma.sql`"created_at" >= ${new Date(input.startAt)}`);
  }
  if (input.endAt) {
    conditions.push(Prisma.sql`"created_at" <= ${new Date(input.endAt)}`);
  }

  if (conditions.length === 0) {
    return Prisma.sql``;
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
}

function mapPrismaRowToItem(item: {
  id: number;
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  message: Prisma.JsonValue;
  eventTime: Date | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): NapcatGroupMessageItem {
  return {
    id: item.id,
    groupId: item.groupId,
    userId: item.userId,
    nickname: item.nickname,
    messageId: item.messageId,
    message: toJsonValue(item.message),
    eventTime: item.eventTime,
    payload: toJsonRecord(item.payload),
    createdAt: item.createdAt,
  };
}

type RawNapcatGroupMessageRow = {
  id: number;
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  message: unknown;
  eventTime: Date | null;
  payload: unknown;
  createdAt: Date;
};

type RawNapcatGroupMessageContextRow = {
  id: number;
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageText: string;
  eventTime: Date | null;
  createdAt: Date;
};

function mapRawRowToItem(row: RawNapcatGroupMessageRow): NapcatGroupMessageItem {
  return {
    id: row.id,
    groupId: row.groupId,
    userId: row.userId,
    nickname: row.nickname,
    messageId: row.messageId,
    message: toJsonValue(row.message),
    eventTime: row.eventTime,
    payload: toJsonRecord(row.payload),
    createdAt: row.createdAt,
  };
}

function mapRawContextRowToItem(
  row: RawNapcatGroupMessageContextRow,
): NapcatGroupMessageContextItem {
  return {
    id: row.id,
    groupId: row.groupId,
    userId: row.userId,
    nickname: row.nickname,
    messageText: row.messageText,
    eventTime: row.eventTime,
    createdAt: row.createdAt,
  };
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  const normalized = toJsonValue(value);
  if (isRecord(normalized)) {
    return normalized;
  }

  return {
    value: normalized,
  };
}

function toJsonValue(value: unknown): JsonValue {
  return normalizeJsonValue(value) as JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return normalizeJsonValue(value);
}

function normalizeJsonValue(value: unknown): Prisma.InputJsonValue {
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

function toContainsPattern(value: string): string {
  return `%${value}%`;
}

function toCount(value: bigint | number | string): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
