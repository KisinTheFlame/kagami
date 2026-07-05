import * as Prisma from "@kagami/persistence/prisma";
import type { Database } from "@kagami/persistence/db/client";
import type { LinearMessageLedgerInsert, LinearMessageLedgerRecord } from "../../domain/ledger.js";
import type { LinearMessageLedgerDao } from "../linear-message-ledger.dao.js";
import {
  deserializeLlmMessage,
  serializeLlmMessage,
} from "../../../../../agent/runtime/context/context-item.utils.js";

export class PrismaLinearMessageLedgerDao implements LinearMessageLedgerDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async insertMany(
    entries: LinearMessageLedgerInsert[],
  ): Promise<LinearMessageLedgerRecord[]> {
    if (entries.length === 0) {
      return [];
    }

    // 单条 INSERT ... RETURNING 批插，取代此前 `$transaction([...map(create)])` 的「N 条 create 各占一
    // 事务/每次 append 一 BEGIN-COMMIT」写法：一轮里 assistant turn + 多条 tool_result 分别 append，逐条
    // 开事务会在共享 WAL 上堆写事务。createManyAndReturn 一条语句落全部行、按插入序返回自增 id（=seq）。
    const rows = await this.database.linearMessageLedger.createManyAndReturn({
      data: entries.map(entry => ({
        runtimeKey: entry.runtimeKey,
        message: serializeLlmMessage(entry.message) as Prisma.InputJsonValue,
        createdAt: entry.createdAt ?? new Date(),
      })),
      select: {
        id: true,
        runtimeKey: true,
        message: true,
        createdAt: true,
      },
    });

    return rows.map(mapLinearMessageLedgerRow);
  }

  public async listCreatedAfter(input: {
    runtimeKey: string;
    createdAfter: Date;
    limit: number;
  }): Promise<LinearMessageLedgerRecord[]> {
    const rows = await this.database.linearMessageLedger.findMany({
      where: {
        runtimeKey: input.runtimeKey,
        createdAt: {
          gt: input.createdAfter,
        },
      },
      orderBy: {
        id: "asc",
      },
      take: Math.max(1, input.limit),
      select: {
        id: true,
        runtimeKey: true,
        message: true,
        createdAt: true,
      },
    });

    return rows.map(mapLinearMessageLedgerRow);
  }
}

function mapLinearMessageLedgerRow(row: {
  id: number;
  runtimeKey: string;
  message: Prisma.JsonValue;
  createdAt: Date;
}): LinearMessageLedgerRecord {
  return {
    seq: row.id,
    runtimeKey: row.runtimeKey,
    message: deserializeLlmMessage(row.message),
    createdAt: row.createdAt,
  };
}
