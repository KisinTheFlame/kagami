import type { AuthUsageTrendRange, AuthUsageTrendWindow } from "@kagami/shared";
import type { LlmProviderId } from "../../common/contracts/llm.js";

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
