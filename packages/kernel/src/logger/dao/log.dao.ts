// 日志域类型由 kernel 自持：与 console 的 wire 查询 schema 形状一致但不共享——
// 存储层接口不被 HTTP wire 形状钉死（shared 退役重划，#279 PR0）。
export type AppLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

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

export type QueryAppLogListFilterInput = {
  level?: AppLogLevel;
  traceId?: string;
  message?: string;
  source?: string;
  startAt?: string;
  endAt?: string;
};

export type QueryAppLogListPageInput = QueryAppLogListFilterInput & {
  page: number;
  pageSize: number;
};

export interface LogDao {
  insertBatch(items: InsertAppLogItem[]): Promise<void>;
  countByQuery(input: QueryAppLogListFilterInput): Promise<number>;
  listByQueryPage(input: QueryAppLogListPageInput): Promise<AppLogItem[]>;
}
