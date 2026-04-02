import { type JsonValue } from "@kagami/shared/schemas/base";
import { type NapcatQqMessageListQuery } from "@kagami/shared/schemas/napcat-group-message";

export type InsertNapcatQqMessageItem = {
  messageType: "group" | "private";
  subType: string;
  groupId: string | null;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  message: JsonValue;
  eventTime: Date | null;
  payload: Record<string, unknown>;
  createdAt?: Date;
};

export type NapcatQqMessageItem = {
  id: number;
  messageType: "group" | "private";
  subType: string;
  groupId: string | null;
  userId: string | null;
  nickname: string | null;
  messageId: number | null;
  message: JsonValue;
  eventTime: Date | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type NapcatQqMessageContextItem = {
  id: number;
  groupId: string;
  userId: string | null;
  nickname: string | null;
  messageText: string;
  eventTime: Date | null;
  createdAt: Date;
};

export type QueryNapcatQqMessageListFilterInput = Omit<
  NapcatQqMessageListQuery,
  "page" | "pageSize"
>;
export type QueryNapcatQqMessageListPageInput = NapcatQqMessageListQuery;

export interface NapcatQqMessageDao {
  insert(item: InsertNapcatQqMessageItem): Promise<number>;
  countByQuery(input: QueryNapcatQqMessageListFilterInput): Promise<number>;
  listByQueryPage(input: QueryNapcatQqMessageListPageInput): Promise<NapcatQqMessageItem[]>;
  listContextWindowById(input: {
    groupId: string;
    messageId: number;
    before: number;
    after: number;
  }): Promise<NapcatQqMessageContextItem[]>;
}
