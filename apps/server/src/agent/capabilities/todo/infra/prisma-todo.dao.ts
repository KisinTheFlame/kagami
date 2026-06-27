import type { Database } from "../../../../db/client.js";
import type {
  CreateTodoInput,
  TodoDao,
  TodoRecord,
  TodoStatus,
  UpdateTodoFields,
} from "../application/todo.dao.js";

export class PrismaTodoDao implements TodoDao {
  private readonly database: Database;

  public constructor({ database }: { database: Database }) {
    this.database = database;
  }

  public async createWithinLimit(input: {
    data: CreateTodoInput;
    maxActive: number;
  }): Promise<TodoRecord | "LIMIT_REACHED"> {
    // count + insert 放一个事务，避免并发 add 都看到上限前的计数而越界。
    return this.database.$transaction(async tx => {
      const count = await tx.todoItem.count({ where: { status: "pending" } });
      if (count >= input.maxActive) {
        return "LIMIT_REACHED" as const;
      }
      const row = await tx.todoItem.create({
        data: {
          title: input.data.title,
          note: input.data.note,
          remindAt: input.data.remindAt,
          repeatEveryMs: input.data.repeatEveryMs,
        },
      });
      return mapRow(row);
    });
  }

  public async findById(input: { id: number }): Promise<TodoRecord | null> {
    const row = await this.database.todoItem.findUnique({ where: { id: input.id } });
    return row ? mapRow(row) : null;
  }

  public async listByStatus(input: { status: TodoStatus; limit?: number }): Promise<TodoRecord[]> {
    const rows = await this.database.todoItem.findMany({
      where: { status: input.status },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...(input.limit !== undefined ? { take: input.limit } : {}),
    });
    return rows.map(mapRow);
  }

  public async countByStatus(input: { status: TodoStatus }): Promise<number> {
    return this.database.todoItem.count({ where: { status: input.status } });
  }

  public async findDueReminders(input: { now: Date }): Promise<TodoRecord[]> {
    const rows = await this.database.todoItem.findMany({
      where: {
        status: "pending",
        remindAt: { lte: input.now },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: input.now } }],
      },
      orderBy: [{ remindAt: "asc" }, { id: "asc" }],
    });
    return rows.map(mapRow);
  }

  public async advanceReminder(input: {
    id: number;
    expectedRemindAt: Date;
    nextRemindAt: Date;
  }): Promise<number> {
    const result = await this.database.todoItem.updateMany({
      where: { id: input.id, status: "pending", remindAt: input.expectedRemindAt },
      data: { remindAt: input.nextRemindAt },
    });
    return result.count;
  }

  public async clearReminder(input: { id: number; expectedRemindAt: Date }): Promise<number> {
    const result = await this.database.todoItem.updateMany({
      where: { id: input.id, status: "pending", remindAt: input.expectedRemindAt },
      data: { remindAt: null },
    });
    return result.count;
  }

  public async markCompleted(input: { id: number; completedAt: Date }): Promise<number> {
    const result = await this.database.todoItem.updateMany({
      where: { id: input.id, status: "pending" },
      data: { status: "completed", completedAt: input.completedAt },
    });
    return result.count;
  }

  public async markRemoved(input: { id: number }): Promise<number> {
    const result = await this.database.todoItem.updateMany({
      where: { id: input.id, status: "pending" },
      data: { status: "removed" },
    });
    return result.count;
  }

  public async setSnooze(input: { id: number; snoozedUntil: Date }): Promise<number> {
    const result = await this.database.todoItem.updateMany({
      where: { id: input.id, status: "pending" },
      data: { snoozedUntil: input.snoozedUntil },
    });
    return result.count;
  }

  public async updateFields(input: { id: number; fields: UpdateTodoFields }): Promise<number> {
    const result = await this.database.todoItem.updateMany({
      where: { id: input.id, status: "pending" },
      data: input.fields,
    });
    return result.count;
  }
}

function mapRow(row: {
  id: number;
  title: string;
  note: string | null;
  status: string;
  remindAt: Date | null;
  repeatEveryMs: number | null;
  snoozedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): TodoRecord {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    status: row.status as TodoStatus,
    remindAt: row.remindAt,
    repeatEveryMs: row.repeatEveryMs,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}
