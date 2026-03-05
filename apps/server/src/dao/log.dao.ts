import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { AppLogListQuery } from "@kagami/shared";
import { appLog } from "../db/schema.js";

export type InsertAppLogItem = InferInsertModel<typeof appLog>;
export type AppLogItem = InferSelectModel<typeof appLog>;

export type QueryAppLogListFilterInput = Omit<AppLogListQuery, "page" | "pageSize">;
export type QueryAppLogListPageInput = AppLogListQuery;

export interface LogDao {
  insertBatch(items: InsertAppLogItem[]): Promise<void>;
  countByQuery(input: QueryAppLogListFilterInput): Promise<number>;
  listByQueryPage(input: QueryAppLogListPageInput): Promise<AppLogItem[]>;
}
