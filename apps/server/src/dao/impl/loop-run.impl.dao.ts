import type { Prisma } from "@prisma/client";
import type { Database } from "../../db/client.js";
import type {
  CreateLoopRunInput,
  CreateLoopRunStepInput,
  FinishLoopRunInput,
  LoopRunDao,
  LoopRunItem,
  LoopRunStepItem,
  QueryLoopRunListFilterInput,
  QueryLoopRunListPageInput,
} from "../loop-run.dao.js";

type PrismaLoopRunDaoDeps = {
  database: Database;
};

export class PrismaLoopRunDao implements LoopRunDao {
  private readonly database: Database;

  public constructor({ database }: PrismaLoopRunDaoDeps) {
    this.database = database;
  }

  public async createRun(input: CreateLoopRunInput): Promise<void> {
    await this.database.loopRun.create({
      data: {
        id: input.id,
        groupId: input.groupId,
        triggerMessageId: input.triggerMessageId,
        status: "running",
        triggerPayload: toInputJsonRecord(input.triggerPayload),
        startedAt: input.startedAt,
      },
    });
  }

  public async createStep(input: CreateLoopRunStepInput): Promise<void> {
    await this.database.loopRunStep.create({
      data: {
        loopRunId: input.loopRunId,
        seq: input.seq,
        type: input.type,
        title: input.title,
        status: input.status,
        payload: toInputJsonRecord(input.payload),
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? null,
        durationMs: input.durationMs ?? null,
      },
    });
  }

  public async finishRun(input: FinishLoopRunInput): Promise<void> {
    await this.database.loopRun.update({
      where: {
        id: input.id,
      },
      data: {
        status: input.status,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
      },
    });
  }

  public async findById(id: string): Promise<LoopRunItem | null> {
    const row = await this.database.loopRun.findUnique({
      where: {
        id,
      },
      include: {
        steps: {
          orderBy: [{ seq: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      groupId: row.groupId,
      triggerMessageId: row.triggerMessageId,
      status: row.status as LoopRunItem["status"],
      triggerPayload: toJsonRecord(row.triggerPayload),
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      steps: row.steps.map(mapStepItem),
    };
  }

  public async countByQuery(input: QueryLoopRunListFilterInput): Promise<number> {
    return await this.database.loopRun.count({
      where: toWhereInput(input),
    });
  }

  public async listPage(input: QueryLoopRunListPageInput): Promise<LoopRunItem[]> {
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.database.loopRun.findMany({
      where: toWhereInput(input),
      include: {
        steps: {
          orderBy: [{ seq: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(row => ({
      id: row.id,
      groupId: row.groupId,
      triggerMessageId: row.triggerMessageId,
      status: row.status as LoopRunItem["status"],
      triggerPayload: toJsonRecord(row.triggerPayload),
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      steps: row.steps.map(mapStepItem),
    }));
  }
}

function toWhereInput(input: QueryLoopRunListFilterInput): Prisma.LoopRunWhereInput {
  return {
    ...(input.groupId ? { groupId: input.groupId } : {}),
    ...(input.status
      ? {
          status: input.status === "partial" ? "running" : input.status,
        }
      : {}),
  };
}

function mapStepItem(item: {
  id: number;
  loopRunId: string;
  seq: number;
  type: string;
  title: string;
  status: string;
  payload: Prisma.JsonValue;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}): LoopRunStepItem {
  return {
    id: item.id,
    loopRunId: item.loopRunId,
    seq: item.seq,
    type: item.type as LoopRunStepItem["type"],
    title: item.title,
    status: item.status as LoopRunStepItem["status"],
    payload: toJsonRecord(item.payload),
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    durationMs: item.durationMs,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  return {
    value,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInputJsonRecord(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeInputJsonValue(value);
  if (typeof normalized === "object" && !Array.isArray(normalized)) {
    return normalized as Prisma.InputJsonObject;
  }

  return {
    value: normalized,
  };
}

function normalizeInputJsonValue(value: unknown): Prisma.InputJsonValue {
  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (currentValue instanceof Date) {
        return currentValue.toISOString();
      }
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }
      if (typeof currentValue === "function" || typeof currentValue === "symbol") {
        return undefined;
      }
      return currentValue;
    });

    if (serialized === undefined) {
      return "undefined";
    }

    const parsed = JSON.parse(serialized) as unknown;
    if (parsed === null) {
      return "null";
    }

    return parsed as Prisma.InputJsonValue;
  } catch {
    return String(value);
  }
}
