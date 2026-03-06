import type { AppLogLevel, AppLogListQuery } from "@kagami/shared";

export type InsertAppLogItem = {
  traceId: string;
  level: AppLogLevel;
  message: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
};

export type AppLogItem = {
  id: number;
  traceId: string;
  level: AppLogLevel;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type QueryAppLogListFilterInput = Omit<AppLogListQuery, "page" | "pageSize">;
export type QueryAppLogListPageInput = AppLogListQuery;

export interface LogDao {
  insertBatch(items: InsertAppLogItem[]): Promise<void>;
  countByQuery(input: QueryAppLogListFilterInput): Promise<number>;
  listByQueryPage(input: QueryAppLogListPageInput): Promise<AppLogItem[]>;
}
