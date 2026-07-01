import * as Prisma from "../../../generated/prisma/internal/prismaNamespace.js";
import { toJsonRecord, toInputJsonObject } from "../../../common/prisma-json.js";
import type { Database } from "../../../db/client.js";
import type {
  AppLogItem,
  InsertAppLogItem,
  LogDao,
  QueryAppLogListFilterInput,
  QueryAppLogListPageInput,
} from "@kagami/kernel/logger/dao/log.dao";

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
    const whereClause = buildAppLogWhereClause(input);
    const rows = await this.database.$queryRaw<
      Array<{ total: bigint | number | string }>
    >(Prisma.sql`
      SELECT COUNT(*) AS "total"
      FROM "app_log"
      ${whereClause}
    `);

    return toCount(rows[0]?.total ?? 0);
  }

  public async listByQueryPage(input: QueryAppLogListPageInput): Promise<AppLogItem[]> {
    const whereClause = buildAppLogWhereClause(input);
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.database.$queryRaw<RawAppLogRow[]>(Prisma.sql`
      SELECT
        "id" AS "id",
        "trace_id" AS "traceId",
        "level" AS "level",
        "message" AS "message",
        "metadata" AS "metadata",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "app_log"
      ${whereClause}
      ORDER BY "created_at" DESC, "id" DESC
      LIMIT ${input.pageSize}
      OFFSET ${offset}
    `);

    return rows.map(row => ({
      id: Number(row.id),
      traceId: row.traceId,
      level: row.level as AppLogItem["level"],
      message: row.message,
      metadata: toJsonRecord(row.metadata),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}

type RawAppLogRow = {
  id: number | bigint;
  traceId: string;
  level: string;
  message: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * SQLite 不支持 Prisma 的 JSON 过滤（`path` / `string_contains`）与 `mode: "insensitive"`，
 * 因此 app_log 的列表/计数走原生 SQL：`source` 用 SQLite 的 `metadata ->> 'source'` 提取，
 * 模糊匹配用 `LIKE`（对 ASCII 默认大小写不敏感）。
 */
function buildAppLogWhereClause(input: QueryAppLogListFilterInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (input.level) {
    conditions.push(Prisma.sql`"level" = ${input.level}`);
  }
  if (input.traceId) {
    conditions.push(Prisma.sql`"trace_id" = ${input.traceId}`);
  }
  if (input.message) {
    conditions.push(Prisma.sql`"message" LIKE ${toContainsPattern(input.message)}`);
  }
  if (input.source) {
    conditions.push(Prisma.sql`"metadata" ->> 'source' LIKE ${toContainsPattern(input.source)}`);
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
