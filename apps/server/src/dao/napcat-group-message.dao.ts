import type { NapcatGroupMessageListQuery } from "@kagami/shared";

export type InsertNapcatGroupMessageItem = {
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  rawMessage: string;
  eventTime: Date | null;
  payload: Record<string, unknown>;
  createdAt?: Date;
};

export type NapcatGroupMessageItem = {
  id: number;
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  rawMessage: string;
  eventTime: Date | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type QueryNapcatGroupMessageListFilterInput = Omit<
  NapcatGroupMessageListQuery,
  "page" | "pageSize"
>;
export type QueryNapcatGroupMessageListPageInput = NapcatGroupMessageListQuery;

export interface NapcatGroupMessageDao {
  insert(item: InsertNapcatGroupMessageItem): Promise<void>;
  countByQuery(input: QueryNapcatGroupMessageListFilterInput): Promise<number>;
  listByQueryPage(input: QueryNapcatGroupMessageListPageInput): Promise<NapcatGroupMessageItem[]>;
}
