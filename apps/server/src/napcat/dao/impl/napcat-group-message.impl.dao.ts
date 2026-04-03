import * as Prisma from "../../../generated/prisma/internal/prismaNamespace.js";
import { type JsonValue } from "@kagami/shared/schemas/base";
import { normalizeInputJsonValue, toJsonRecord } from "../../../common/prisma-json.js";
import type { Database } from "../../../db/client.js";
import type {
  InsertNapcatQqMessageItem,
  NapcatQqMessageContextItem,
  NapcatQqMessageDao,
  NapcatQqMessageItem,
  QueryNapcatQqMessageListFilterInput,
  QueryNapcatQqMessageListPageInput,
} from "../napcat-group-message.dao.js";

type PrismaNapcatQqMessageDaoDeps = {
  database: Database;
};

export class PrismaNapcatQqMessageDao implements NapcatQqMessageDao {
  private readonly database: Database;

  public constructor({ database }: PrismaNapcatQqMessageDaoDeps) {
    this.database = database;
  }

  public async insert(item: InsertNapcatQqMessageItem): Promise<number> {
    const row = await this.database.napcatQqMessage.create({
      data: {
        messageType: item.messageType,
        subType: item.subType,
        groupId: item.groupId,
        userId: item.userId,
        nickname: item.nickname,
        messageId: item.messageId,
        message: normalizeInputJsonValue(item.message),
        eventTime: item.eventTime,
        payload: normalizeInputJsonValue(item.payload),
        createdAt: item.createdAt,
      },
      select: {
        id: true,
      },
    });

    return row.id;
  }

  public async countByQuery(input: QueryNapcatQqMessageListFilterInput): Promise<number> {
    if (input.keyword) {
      return this.countByKeywordQuery(input);
    }

    const where = buildWhereInput(input);
    return this.database.napcatQqMessage.count({ where });
  }

  public async listByQueryPage(
    input: QueryNapcatQqMessageListPageInput,
  ): Promise<NapcatQqMessageItem[]> {
    if (input.keyword) {
      return this.listByKeywordQuery(input);
    }

    const where = buildWhereInput(input);
    const offset = (input.page - 1) * input.pageSize;

    const rows = await this.database.napcatQqMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(mapPrismaRowToItem);
  }

  private async countByKeywordQuery(input: QueryNapcatQqMessageListFilterInput): Promise<number> {
    const whereClause = buildKeywordSqlWhereClause(input);
    const rows = await this.database.$queryRaw<
      Array<{ total: bigint | number | string }>
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS "total"
      FROM "napcat_qq_message"
      ${whereClause}
    `);

    return toCount(rows[0]?.total ?? 0);
  }

  private async listByKeywordQuery(
    input: QueryNapcatQqMessageListPageInput,
  ): Promise<NapcatQqMessageItem[]> {
    const whereClause = buildKeywordSqlWhereClause(input);
    const offset = (input.page - 1) * input.pageSize;

    const rows = await this.database.$queryRaw<RawNapcatQqMessageRow[]>(Prisma.sql`
      SELECT
        "id" AS "id",
        "message_type" AS "messageType",
        "sub_type" AS "subType",
        "group_id" AS "groupId",
        "user_id" AS "userId",
        "nickname" AS "nickname",
        "message_id" AS "messageId",
        "message" AS "message",
        "event_time" AS "eventTime",
        "payload" AS "payload",
        "created_at" AS "createdAt"
      FROM "napcat_qq_message"
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
  }): Promise<NapcatQqMessageContextItem[]> {
    const rows = await this.database.$queryRaw<RawNapcatQqMessageContextRow[]>(Prisma.sql`
      WITH ordered_messages AS (
        SELECT
          gm."id" AS "id",
          gm."group_id" AS "groupId",
          gm."user_id" AS "userId",
          gm."nickname" AS "nickname",
          COALESCE(
            gm."payload"->>'raw_message',
            gm."message"::text
          ) AS "messageText",
          gm."event_time" AS "eventTime",
          gm."created_at" AS "createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY gm."group_id"
            ORDER BY COALESCE(gm."event_time", gm."created_at") ASC, gm."id" ASC
          ) AS "rowNumber"
        FROM "napcat_qq_message" AS gm
        WHERE gm."message_type" = 'group' AND gm."group_id" = ${input.groupId}
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
  input: QueryNapcatQqMessageListFilterInput,
): Prisma.NapcatQqMessageWhereInput {
  const where: Prisma.NapcatQqMessageWhereInput = {};

  if (input.messageType) {
    where.messageType = input.messageType;
  }
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

function buildKeywordSqlWhereClause(input: QueryNapcatQqMessageListFilterInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (input.messageType) {
    conditions.push(Prisma.sql`"message_type" = ${input.messageType}`);
  }
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
  messageType: string;
  subType: string;
  groupId: string | null;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  message: Prisma.JsonValue;
  eventTime: Date | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
}): NapcatQqMessageItem {
  return {
    id: item.id,
    messageType: toMessageType(item.messageType),
    subType: item.subType,
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

type RawNapcatQqMessageRow = {
  id: number;
  messageType: string;
  subType: string;
  groupId: string | null;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  message: unknown;
  eventTime: Date | null;
  payload: unknown;
  createdAt: Date;
};

type RawNapcatQqMessageContextRow = {
  id: number;
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageText: string;
  eventTime: Date | null;
  createdAt: Date;
};

function mapRawRowToItem(row: RawNapcatQqMessageRow): NapcatQqMessageItem {
  return {
    id: row.id,
    messageType: toMessageType(row.messageType),
    subType: row.subType,
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

function mapRawContextRowToItem(row: RawNapcatQqMessageContextRow): NapcatQqMessageContextItem {
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

function toJsonValue(value: unknown): JsonValue {
  return normalizeInputJsonValue(value) as JsonValue;
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

function toMessageType(value: string): "group" | "private" {
  return value === "private" ? "private" : "group";
}
