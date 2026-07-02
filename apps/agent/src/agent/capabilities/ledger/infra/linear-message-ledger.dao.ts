import type { LinearMessageLedgerInsert, LinearMessageLedgerRecord } from "../domain/ledger.js";

export interface LinearMessageLedgerDao {
  insertMany(entries: LinearMessageLedgerInsert[]): Promise<LinearMessageLedgerRecord[]>;
}
