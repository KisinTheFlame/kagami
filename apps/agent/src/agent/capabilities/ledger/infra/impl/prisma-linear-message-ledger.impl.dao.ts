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

    const rows = await this.database.$transaction(
      entries.map(entry =>
        this.database.linearMessageLedger.create({
          data: {
            runtimeKey: entry.runtimeKey,
            message: serializeLlmMessage(entry.message) as Prisma.InputJsonValue,
            createdAt: entry.createdAt ?? new Date(),
          },
          select: {
            id: true,
            runtimeKey: true,
            message: true,
            createdAt: true,
          },
        }),
      ),
    );

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
