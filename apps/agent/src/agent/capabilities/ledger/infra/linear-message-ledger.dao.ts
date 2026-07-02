import type { LinearMessageLedgerInsert, LinearMessageLedgerRecord } from "../domain/ledger.js";

export interface LinearMessageLedgerDao {
  insertMany(entries: LinearMessageLedgerInsert[]): Promise<LinearMessageLedgerRecord[]>;
  /**
   * 按创建时间读取（seq 升序）。给需要「最近一段时间」而非「某 seq 之后」的消费者用，
   * 首个消费者是 inner-voice 摸鱼判定的重启回扫（issue #265）。
   */
  listCreatedAfter(input: {
    runtimeKey: string;
    createdAfter: Date;
    limit: number;
  }): Promise<LinearMessageLedgerRecord[]>;
}
