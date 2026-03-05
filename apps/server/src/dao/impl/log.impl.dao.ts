import { and, count, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { appLog } from "../../db/schema.js";
import type {
  AppLogItem,
  InsertAppLogItem,
  LogDao,
  QueryAppLogListFilterInput,
  QueryAppLogListPageInput,
} from "../log.dao.js";

type DrizzleLogDaoDeps = {
  database: Database;
};

export class DrizzleLogDao implements LogDao {
  private readonly database: Database;

  public constructor({ database }: DrizzleLogDaoDeps) {
    this.database = database;
  }

  public async insertBatch(items: InsertAppLogItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    await this.database.insert(appLog).values(items);
  }

  public async countByQuery(input: QueryAppLogListFilterInput): Promise<number> {
    const whereClause = buildWhereClause(input);
    const [{ total }] = await this.database
      .select({ total: count() })
      .from(appLog)
      .where(whereClause);
    return total;
  }

  public async listByQueryPage(input: QueryAppLogListPageInput): Promise<AppLogItem[]> {
    const whereClause = buildWhereClause(input);
    const offset = (input.page - 1) * input.pageSize;
    return this.database
      .select()
      .from(appLog)
      .where(whereClause)
      .orderBy(desc(appLog.createdAt), desc(appLog.id))
      .limit(input.pageSize)
      .offset(offset);
  }
}

function buildWhereClause(input: QueryAppLogListFilterInput): SQL | undefined {
  const conditions: SQL[] = [];

  if (input.level) {
    conditions.push(eq(appLog.level, input.level));
  }
  if (input.traceId) {
    conditions.push(eq(appLog.traceId, input.traceId));
  }
  if (input.message) {
    conditions.push(ilike(appLog.message, `%${input.message}%`));
  }
  if (input.source) {
    conditions.push(sql<boolean>`${appLog.metadata} ->> 'source' ILIKE ${`%${input.source}%`}`);
  }
  if (input.startAt) {
    conditions.push(gte(appLog.createdAt, new Date(input.startAt)));
  }
  if (input.endAt) {
    conditions.push(lte(appLog.createdAt, new Date(input.endAt)));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}
