import type { Database } from "../db/client.js";
import { NapcatAgentEventSchema, type NapcatOutboxEvent } from "@kagami/napcat-api/event";
import type { NapcatAgentEvent } from "@kagami/napcat-api/event";
import type { NapcatEventOutboxDao } from "../napcat-event-outbox.dao.js";

type PrismaNapcatEventOutboxDaoDeps = {
  database: Database;
};

export class PrismaNapcatEventOutboxDao implements NapcatEventOutboxDao {
  private readonly database: Database;

  public constructor({ database }: PrismaNapcatEventOutboxDaoDeps) {
    this.database = database;
  }

  public async append(event: NapcatAgentEvent): Promise<number> {
    const row = await this.database.napcatEventOutbox.create({
      data: { event: event as object },
      select: { seq: true },
    });
    return row.seq;
  }

  public async listAfter(afterSeq: number, limit: number): Promise<NapcatOutboxEvent[]> {
    const rows = await this.database.napcatEventOutbox.findMany({
      where: { seq: { gt: afterSeq } },
      orderBy: { seq: "asc" },
      take: limit,
      select: { seq: true, event: true },
    });
    // 读时按 napcat-api schema 校验事件形状，隔离潜在的历史 / 手改脏数据；无法解析的行直接跳过
    // （回放宁可漏一条坏数据也不整段崩）。
    const events: NapcatOutboxEvent[] = [];
    for (const row of rows) {
      const parsed = NapcatAgentEventSchema.safeParse(row.event);
      if (parsed.success) {
        events.push({ seq: row.seq, event: parsed.data });
      }
    }
    return events;
  }

  public async latestSeq(): Promise<number> {
    const row = await this.database.napcatEventOutbox.findFirst({
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    return row?.seq ?? 0;
  }

  public async pruneOlderThan(cutoff: Date): Promise<number> {
    const result = await this.database.napcatEventOutbox.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
