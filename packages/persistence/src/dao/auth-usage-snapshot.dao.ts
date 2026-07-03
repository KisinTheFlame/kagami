import type { LlmProviderId } from "@kagami/llm";

// 用量窗口 / 区间枚举由存储层自持：与 llm-api 的 wire schema 取值一致但不共享（#279 PR0）。
export type AuthUsageTrendRange = "24h" | "7d";
export type AuthUsageTrendWindow = "five_hour" | "seven_day";

export type AuthUsageSnapshotItem = {
  id: number;
  provider: LlmProviderId;
  accountId: string;
  windowKey: AuthUsageTrendWindow;
  remainingPercent: number;
  resetAt: Date | null;
  capturedAt: Date;
};

export type InsertAuthUsageSnapshotInput = {
  provider: LlmProviderId;
  accountId: string;
  windowKey: AuthUsageTrendWindow;
  remainingPercent: number;
  resetAt?: Date | null;
  capturedAt: Date;
};

export type QueryAuthUsageSnapshotInput = {
  provider: LlmProviderId;
  accountId: string;
  range: AuthUsageTrendRange;
};

export interface AuthUsageSnapshotDao {
  insertBatch(items: InsertAuthUsageSnapshotInput[]): Promise<void>;
  listByRange(input: QueryAuthUsageSnapshotInput): Promise<AuthUsageSnapshotItem[]>;
}
