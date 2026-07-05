import type { NapcatAgentEvent, NapcatOutboxEvent } from "@kagami/napcat-api/event";

/**
 * agent-facing 事件 outbox（issue #347）：napcat 每产生一个渲染好的 NapcatAgentEvent，先事务
 * 落这里拿单调 seq（= SSE event id），再推 SSE。agent 重连带 Last-Event-ID 回放 seq> 缺口、按
 * seq 去重（严格 at-least-once）。定期 prune 掉超保留窗口的旧行防膨胀。
 */
export interface NapcatEventOutboxDao {
  /** 追加一个事件，返回分配到的单调 seq。 */
  append(event: NapcatAgentEvent): Promise<number>;
  /** 取 seq > afterSeq 的事件（升序），最多 limit 条。用于重连缺口回放。 */
  listAfter(afterSeq: number, limit: number): Promise<NapcatOutboxEvent[]>;
  /** 当前最大 seq（无行时 0）。 */
  latestSeq(): Promise<number>;
  /** 删除 createdAt < cutoff 的行，返回删除条数。 */
  pruneOlderThan(cutoff: Date): Promise<number>;
}
