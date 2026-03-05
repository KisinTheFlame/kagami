import type { InferInsertModel } from "drizzle-orm";
import { appLog } from "../db/schema.js";

export type InsertAppLogItem = InferInsertModel<typeof appLog>;

export interface LogDao {
  insertBatch(items: InsertAppLogItem[]): Promise<void>;
}
