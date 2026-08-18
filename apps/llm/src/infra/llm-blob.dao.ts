/**
 * `llm_blob` 的持久化端口（issue #612）。内容寻址：同一段字节在库里只有一行。
 *
 * 命中复用时会给 blob 续期（`lastUsedAt`），这是 mark-sweep GC 不误删的前提，不是统计字段。
 *
 * 写入刻意**不与 `llm_chat_call` 行插入同事务**：blob 是幂等的，先写 blob 再写行，中途失败
 * 最多留下没人引用的孤儿——而孤儿正是 mark-sweep GC 每天要扫的东西，它自愈。反过来的顺序
 * （先写行再写 blob）会让行引用到不存在的 blob，禁止。
 */

export type LlmBlobGcCandidate = {
  id: number;
  storedBytes: number;
};

export type ResolveBlobIdsResult = {
  /** 与入参**同序同长**的 blob id。 */
  ids: number[];
  /** 本次真正新插入的 blob 行数（复用的不计）。 */
  insertedCount: number;
  /** 本次新插入 blob 的入库字节之和（压缩后口径）。 */
  insertedStoredBytes: number;
};

export interface LlmBlobDao {
  /** 按内容解析 id：命中复用，缺失插入。入参可含重复，返回按入参顺序展开。 */
  resolveIds(raws: readonly Buffer[]): Promise<ResolveBlobIdsResult>;
  /** 批量取回并解压。缺失的 id 不出现在结果 Map 里。 */
  loadMany(ids: readonly number[]): Promise<Map<number, Buffer>>;
  /**
   * GC 用：按 id 升序游标翻页取回收候选，只取 id 与入库字节，不读 bytes 本体。
   * `usedBefore` 之后被引用过的 blob 不是候选——它堵住「mark 之后 sweep 之前被重新引用」
   * 这个悬挂引用窗口。
   */
  listGcCandidates(input: {
    afterId: number;
    usedBefore: Date;
    limit: number;
  }): Promise<LlmBlobGcCandidate[]>;
  deleteByIds(ids: readonly number[]): Promise<number>;
}
