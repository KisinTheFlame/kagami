import type { NapcatEventListQuery } from "@kagami/shared";

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

export type QueryNapcatEventListFilterInput = Omit<NapcatEventListQuery, "page" | "pageSize">;
export type QueryNapcatEventListPageInput = NapcatEventListQuery;

export interface NapcatEventDao {
  insert(item: InsertNapcatEventItem): Promise<void>;
  countByQuery(input: QueryNapcatEventListFilterInput): Promise<number>;
  listByQueryPage(input: QueryNapcatEventListPageInput): Promise<NapcatEventItem[]>;
}
