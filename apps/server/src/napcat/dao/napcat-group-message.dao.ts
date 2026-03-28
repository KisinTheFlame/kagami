import { type JsonValue } from "@kagami/shared/schemas/base";
import { type NapcatGroupMessageListQuery } from "@kagami/shared/schemas/napcat-group-message";

export type InsertNapcatGroupMessageItem = {
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  message: JsonValue;
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
  message: JsonValue;
  eventTime: Date | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type NapcatGroupMessageContextItem = {
  id: number;
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageText: string;
  eventTime: Date | null;
  createdAt: Date;
};

export type QueryNapcatGroupMessageListFilterInput = Omit<
  NapcatGroupMessageListQuery,
  "page" | "pageSize"
>;
export type QueryNapcatGroupMessageListPageInput = NapcatGroupMessageListQuery;

export interface NapcatGroupMessageDao {
  insert(item: InsertNapcatGroupMessageItem): Promise<number>;
  countByQuery(input: QueryNapcatGroupMessageListFilterInput): Promise<number>;
  listByQueryPage(input: QueryNapcatGroupMessageListPageInput): Promise<NapcatGroupMessageItem[]>;
  listContextWindowById(input: {
    groupId: string;
    messageId: number;
    before: number;
    after: number;
  }): Promise<NapcatGroupMessageContextItem[]>;
}
