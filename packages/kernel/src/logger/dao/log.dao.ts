// 日志域类型由 kernel 自持：与 observatory 的 wire 查询 schema 形状一致但不共享——
// 存储层接口不被 HTTP wire 形状钉死（shared 退役重划，#279 PR0）。
//
// 实现方自 #608 起是 observatory（`apps/observatory/src/infra/impl/log.impl.dao.ts`），
// 表随之迁出 agent 主库；kernel 只留接口与域类型，`DbLogSink` 面向它编程。
export type AppLogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type InsertAppLogItem = {
  /**
   * 产出这条日志的**进程**（agent / console / napcat / …）。与 `metadata.source` 的**模块**
   * 标识是两个维度，别挤一个字段——#602 就踩过（commit d973d250）。
   */
  service: string;
  traceId: string;
  level: AppLogLevel;
  message: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
};

export type AppLogItem = {
  id: number;
  service: string;
  traceId: string;
  level: AppLogLevel;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type QueryAppLogListFilterInput = {
  service?: string;
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
  /** 删除 `created_at < threshold` 的行，返回删除条数（#608 的 7 天保留清理）。 */
  deleteOlderThan(threshold: Date): Promise<number>;
}
