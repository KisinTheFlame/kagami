import type { Prisma } from "../../../generated/prisma/client.js";
import type {
  AuthUsageSnapshotDao,
  AuthUsageSnapshotItem,
  InsertAuthUsageSnapshotInput,
  QueryAuthUsageSnapshotInput,
} from "../auth-usage-snapshot.dao.js";
import type { Database } from "../../../db/client.js";

type PrismaAuthUsageSnapshotDaoDeps = {
  database: Database;
};

export class PrismaAuthUsageSnapshotDao implements AuthUsageSnapshotDao {
  private readonly database: Database;

  public constructor({ database }: PrismaAuthUsageSnapshotDaoDeps) {
    this.database = database;
  }

  public async insertBatch(items: InsertAuthUsageSnapshotInput[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    await this.database.authUsageSnapshot.createMany({
      data: items.map(item => ({
        provider: item.provider,
        accountId: item.accountId,
        windowKey: item.windowKey,
        remainingPercent: item.remainingPercent,
        resetAt: item.resetAt ?? null,
        capturedAt: item.capturedAt,
      })),
    });
  }

  public async listByRange(input: QueryAuthUsageSnapshotInput): Promise<AuthUsageSnapshotItem[]> {
    const rows = await this.database.authUsageSnapshot.findMany({
      where: buildWhereInput(input),
      orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
    });

    return rows.map(item => ({
      id: item.id,
      provider: item.provider as AuthUsageSnapshotItem["provider"],
      accountId: item.accountId,
      windowKey: item.windowKey as AuthUsageSnapshotItem["windowKey"],
      remainingPercent: item.remainingPercent,
      resetAt: item.resetAt,
      capturedAt: item.capturedAt,
    }));
  }
}

function buildWhereInput(input: QueryAuthUsageSnapshotInput): Prisma.AuthUsageSnapshotWhereInput {
  return {
    provider: input.provider,
    accountId: input.accountId,
    capturedAt: {
      gte: getRangeStart(input.range),
    },
  };
}

function getRangeStart(range: QueryAuthUsageSnapshotInput["range"]): Date {
  const now = Date.now();
  if (range === "7d") {
    return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }

  return new Date(now - 24 * 60 * 60 * 1000);
}
