export type InnerThoughtOutcome = "injected" | "empty" | "failed";

export type InnerThoughtSummary = {
  id: number;
  triggeredAt: Date;
  outcome: InnerThoughtOutcome;
  thought: string;
  runtimeKey: string;
  createdAt: Date;
};

export type QueryInnerThoughtListInput = {
  page: number;
  pageSize: number;
  outcome?: InnerThoughtOutcome;
};

export type InsertInnerThoughtInput = {
  triggeredAt: Date;
  outcome: InnerThoughtOutcome;
  thought: string;
  runtimeKey: string;
};

/**
 * inner-voice 念头账本（issue #359）：agent 侧写（每次摸鱼触发落一行），console 侧读（分页展示）。
 * 与 `LlmChatCallDao` 同构——一份 DAO 两处 new，靠 SQLite WAL 并发同库。
 */
export interface InnerThoughtDao {
  insert(input: InsertInnerThoughtInput): Promise<void>;
  countByQuery(input: QueryInnerThoughtListInput): Promise<number>;
  listPage(input: QueryInnerThoughtListInput): Promise<InnerThoughtSummary[]>;
}
