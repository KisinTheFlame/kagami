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
export type ListRecentInjectedInput = {
  runtimeKey: string;
  limit: number;
};

export interface InnerThoughtDao {
  insert(input: InsertInnerThoughtInput): Promise<void>;
  /**
   * 取某个 runtime 最近若干条**已注入且正文非空**的念头（最新在前）。inner-voice 的 R1 拿它
   * 展示「最近想过什么」用（issue #596）。不复用 `listPage`：那个不能按 runtimeKey 筛，多
   * runtime 下会串味。
   */
  listRecentInjected(input: ListRecentInjectedInput): Promise<string[]>;
  countByQuery(input: QueryInnerThoughtListInput): Promise<number>;
  listPage(input: QueryInnerThoughtListInput): Promise<InnerThoughtSummary[]>;
}
