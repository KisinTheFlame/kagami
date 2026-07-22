import { type JsonValue } from "@kagami/http/wire";

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

// 查询入参由存储层自持：与 console-api 的 wire 查询 schema 形状一致但不共享（#279 PR0）。
export type QueryNapcatQqMessageListFilterInput = {
  messageType?: "group" | "private";
  groupId?: string;
  userId?: string;
  nickname?: string;
  keyword?: string;
  startAt?: string;
  endAt?: string;
};

export type QueryNapcatQqMessageListPageInput = QueryNapcatQqMessageListFilterInput & {
  page: number;
  pageSize: number;
};

export interface NapcatQqMessageDao {
  insert(item: InsertNapcatQqMessageItem): Promise<number>;
  findByNapcatMessageId(messageId: number): Promise<NapcatQqMessageItem | null>;
  countByQuery(input: QueryNapcatQqMessageListFilterInput): Promise<number>;
  listByQueryPage(input: QueryNapcatQqMessageListPageInput): Promise<NapcatQqMessageItem[]>;
  listContextWindowById(input: {
    groupId: string;
    messageId: number;
    before: number;
    after: number;
  }): Promise<NapcatQqMessageContextItem[]>;
  /** 保留清理（epic #539：随表从 agent 的 data-retention 迁入 napcat）：删 createdAt < cutoff 的行。 */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
