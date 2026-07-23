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
 * inner-voice 念头账本（issue #359）：agent 写（每次摸鱼触发落一行）+ agent 的 OpsQueryHandler 读
 * （console 自 #539 子 issue 4 起零 DB，经 @kagami/agent-api 查询路由取数，不再直连本 DAO）。
 */
export interface InnerThoughtDao {
  insert(input: InsertInnerThoughtInput): Promise<void>;
  countByQuery(input: QueryInnerThoughtListInput): Promise<number>;
  listPage(input: QueryInnerThoughtListInput): Promise<InnerThoughtSummary[]>;
}
