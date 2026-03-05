import type { Database } from "../../db/client.js";
import { appLog } from "../../db/schema.js";
import type { InsertAppLogItem, LogDao } from "../log.dao.js";

type DrizzleLogDaoDeps = {
  database: Database;
};

export class DrizzleLogDao implements LogDao {
  private readonly database: Database;

  public constructor({ database }: DrizzleLogDaoDeps) {
    this.database = database;
  }

  public async insertBatch(items: InsertAppLogItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    await this.database.insert(appLog).values(items);
  }
}
