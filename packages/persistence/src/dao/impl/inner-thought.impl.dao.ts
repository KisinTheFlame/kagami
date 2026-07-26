import type * as Prisma from "../../generated/prisma/internal/prismaNamespace.js";
import type { Database } from "../../db/client.js";
import type {
  InnerThoughtDao,
  InnerThoughtOutcome,
  InnerThoughtSummary,
  InsertInnerThoughtInput,
  ListRecentInjectedInput,
  QueryInnerThoughtListInput,
} from "../inner-thought.dao.js";

type PrismaInnerThoughtDaoDeps = {
  database: Database;
};

export class PrismaInnerThoughtDao implements InnerThoughtDao {
  private readonly database: Database;

  public constructor({ database }: PrismaInnerThoughtDaoDeps) {
    this.database = database;
  }

  public async insert(input: InsertInnerThoughtInput): Promise<void> {
    await this.database.innerThought.create({
      data: {
        triggeredAt: input.triggeredAt,
        outcome: input.outcome,
        thought: input.thought,
        runtimeKey: input.runtimeKey,
      },
    });
  }

  public async countByQuery(input: QueryInnerThoughtListInput): Promise<number> {
    return this.database.innerThought.count({
      where: toWhereInput(input),
    });
  }

  public async listRecentInjected(input: ListRecentInjectedInput): Promise<string[]> {
    const rows = await this.database.innerThought.findMany({
      where: { runtimeKey: input.runtimeKey, outcome: "injected", NOT: { thought: "" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
      select: { thought: true },
    });

    return rows.map(row => row.thought);
  }

  public async listPage(input: QueryInnerThoughtListInput): Promise<InnerThoughtSummary[]> {
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.database.innerThought.findMany({
      where: toWhereInput(input),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(item => ({
      id: item.id,
      triggeredAt: item.triggeredAt,
      outcome: item.outcome as InnerThoughtOutcome,
      thought: item.thought,
      runtimeKey: item.runtimeKey,
      createdAt: item.createdAt,
    }));
  }
}

function toWhereInput(input: QueryInnerThoughtListInput): Prisma.InnerThoughtWhereInput {
  return {
    ...(input.outcome ? { outcome: input.outcome } : {}),
  };
}
