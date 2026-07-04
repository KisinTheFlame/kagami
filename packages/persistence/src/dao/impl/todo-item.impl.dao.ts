import type * as Prisma from "../../generated/prisma/internal/prismaNamespace.js";
import type { Database } from "../../db/client.js";
import type {
  QueryTodoItemListInput,
  TodoItemQueryDao,
  TodoItemRow,
  TodoItemStatus,
} from "../todo-item.dao.js";

type PrismaTodoItemDaoDeps = {
  database: Database;
};

export class PrismaTodoItemDao implements TodoItemQueryDao {
  private readonly database: Database;

  public constructor({ database }: PrismaTodoItemDaoDeps) {
    this.database = database;
  }

  public async countByQuery(input: QueryTodoItemListInput): Promise<number> {
    return this.database.todoItem.count({
      where: toWhereInput(input),
    });
  }

  public async listPage(input: QueryTodoItemListInput): Promise<TodoItemRow[]> {
    const offset = (input.page - 1) * input.pageSize;
    const rows = await this.database.todoItem.findMany({
      where: toWhereInput(input),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.pageSize,
      skip: offset,
    });

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      note: row.note,
      status: row.status as TodoItemStatus,
      remindAt: row.remindAt,
      repeatEveryMs: row.repeatEveryMs,
      snoozedUntil: row.snoozedUntil,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
    }));
  }
}

function toWhereInput(input: QueryTodoItemListInput): Prisma.TodoItemWhereInput {
  return {
    ...(input.status ? { status: input.status } : {}),
  };
}
