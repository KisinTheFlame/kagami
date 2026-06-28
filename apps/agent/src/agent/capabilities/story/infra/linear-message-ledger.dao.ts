import type { LinearMessageLedgerInsert, LinearMessageLedgerRecord } from "../domain/story.js";

export interface LinearMessageLedgerDao {
  insertMany(entries: LinearMessageLedgerInsert[]): Promise<LinearMessageLedgerRecord[]>;
  listAfterSeq(input: {
    runtimeKey: string;
    afterSeq: number;
    limit: number;
  }): Promise<LinearMessageLedgerRecord[]>;
  countAfterSeq(input: { runtimeKey: string; afterSeq: number }): Promise<number>;
  findLatest(input: { runtimeKey: string }): Promise<LinearMessageLedgerRecord | null>;
}
