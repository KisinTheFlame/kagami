import type {
  AppLogItem,
  InsertAppLogItem,
  LogDao,
  QueryAppLogListFilterInput,
  QueryAppLogListPageInput,
} from "@kagami/kernel/logger/dao/log.dao";
import * as Prisma from "../../generated/prisma/internal/prismaNamespace.js";
import type { Database } from "../db/client.js";
import { toInputJsonObject, toJsonRecord } from "../db/prisma-json.js";

type PrismaLogDaoDeps = {
  database: Database;
};

/**
 * `app_log` 的 Prisma 实现（issue #608）。逻辑从 `@kagami/persistence` 的同名 DAO 原样搬来，
 * 只多了 `service` 这一个过滤条件与列——本次迁移不重写查询语义，把风险面压到最小。
 */
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
        service: item.service,
        traceId: item.traceId,
        level: item.level,
        message: item.message,
        metadata: toInputJsonObject(item.metadata),
        createdAt: item.createdAt,
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
        "service" AS "service",
        "trace_id" AS "traceId",
        "level" AS "level",
        "message" AS "message",
        "metadata" AS "metadata",
        "created_at" AS "createdAt"
      FROM "app_log"
      ${whereClause}
      ORDER BY "created_at" DESC, "id" DESC
      LIMIT ${input.pageSize}
      OFFSET ${offset}
    `);

    return rows.map(row => ({
      id: Number(row.id),
      service: row.service,
      traceId: row.traceId,
      level: row.level as AppLogItem["level"],
      message: row.message,
      metadata: toJsonRecord(row.metadata),
      createdAt: row.createdAt,
    }));
  }

  public async deleteOlderThan(threshold: Date): Promise<number> {
    const { count } = await this.database.appLog.deleteMany({
      where: { createdAt: { lt: threshold } },
    });
    return count;
  }
}

type RawAppLogRow = {
  id: number | bigint;
  service: string;
  traceId: string;
  level: string;
  message: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
};

/**
 * SQLite 不支持 Prisma 的 JSON 过滤（`path` / `string_contains`）与 `mode: "insensitive"`，
 * 因此 app_log 的列表/计数走原生 SQL：`source` 用 SQLite 的 `metadata ->> 'source'` 提取，
 * 模糊匹配用 `LIKE`（对 ASCII 默认大小写不敏感）。
 *
 * `service`（进程）走**精确等值**，`source`（模块）走模糊——前者是有限的进程名集合、要能精确
 * 筛出一个进程；后者是自由文本，用户记得半截也该搜得到。
 */
function buildAppLogWhereClause(input: QueryAppLogListFilterInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (input.service) {
    conditions.push(Prisma.sql`"service" = ${input.service}`);
  }
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
