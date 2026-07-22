export type InsertNapcatEventItem = {
  postType: string;
  messageType: string | null;
  subType: string | null;
  userId: string | null;
  groupId: string | null;
  eventTime: Date | null;
  payload: Record<string, unknown>;
  createdAt?: Date;
};

export type NapcatEventItem = {
  id: number;
  postType: string;
  messageType: string | null;
  subType: string | null;
  userId: string | null;
  groupId: string | null;
  eventTime: Date | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

// 查询入参由存储层自持：与 console-api 的 wire 查询 schema 形状一致但不共享（#279 PR0）。
export type QueryNapcatEventListFilterInput = {
  postType?: string;
  messageType?: string;
  userId?: string;
  startAt?: string;
  endAt?: string;
};

export type QueryNapcatEventListPageInput = QueryNapcatEventListFilterInput & {
  page: number;
  pageSize: number;
};

export interface NapcatEventDao {
  insert(item: InsertNapcatEventItem): Promise<void>;
  countByQuery(input: QueryNapcatEventListFilterInput): Promise<number>;
  listByQueryPage(input: QueryNapcatEventListPageInput): Promise<NapcatEventItem[]>;
  /** 保留清理（epic #539：随表从 agent 的 data-retention 迁入 napcat）：删 createdAt < cutoff 的行。 */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
