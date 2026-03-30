import * as Prisma from "../../../../../generated/prisma/internal/prismaNamespace.js";
import type { Database } from "../../../../../db/client.js";
import type { LinearMessageLedgerInsert, LinearMessageLedgerRecord } from "../../domain/story.js";
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

  public async listAfterSeq(input: {
    runtimeKey: string;
    afterSeq: number;
    limit: number;
  }): Promise<LinearMessageLedgerRecord[]> {
    const rows = await this.database.linearMessageLedger.findMany({
      where: {
        runtimeKey: input.runtimeKey,
        id: {
          gt: input.afterSeq,
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

  public async countAfterSeq(input: { runtimeKey: string; afterSeq: number }): Promise<number> {
    return await this.database.linearMessageLedger.count({
      where: {
        runtimeKey: input.runtimeKey,
        id: {
          gt: input.afterSeq,
        },
      },
    });
  }

  public async findLatest(input: {
    runtimeKey: string;
  }): Promise<LinearMessageLedgerRecord | null> {
    const row = await this.database.linearMessageLedger.findFirst({
      where: {
        runtimeKey: input.runtimeKey,
      },
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        runtimeKey: true,
        message: true,
        createdAt: true,
      },
    });

    return row ? mapLinearMessageLedgerRow(row) : null;
  }
}

type RawLinearMessageLedgerRow = {
  seq: number;
  runtimeKey: string;
  message: Prisma.JsonValue;
  createdAt: Date;
};

function mapRawLinearMessageLedgerRow(row: RawLinearMessageLedgerRow): LinearMessageLedgerRecord {
  return {
    seq: row.seq,
    runtimeKey: row.runtimeKey,
    message: deserializeLlmMessage(row.message),
    createdAt: row.createdAt,
  };
}

function mapLinearMessageLedgerRow(row: {
  id: number;
  runtimeKey: string;
  message: Prisma.JsonValue;
  createdAt: Date;
}): LinearMessageLedgerRecord {
  return mapRawLinearMessageLedgerRow({
    seq: row.id,
    runtimeKey: row.runtimeKey,
    message: row.message,
    createdAt: row.createdAt,
  });
}
