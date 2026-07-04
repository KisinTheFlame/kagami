import { type TodoListQuery, type TodoListResponse } from "@kagami/console-api/todo";
import type { TodoItemQueryDao } from "@kagami/persistence/dao/todo-item.dao";
import type { TodoQueryService } from "./todo-query.service.js";
import { mapTodoList } from "../mappers/todo.mapper.js";

type DefaultTodoQueryServiceDeps = {
  todoItemDao: TodoItemQueryDao;
};

export class DefaultTodoQueryService implements TodoQueryService {
  private readonly todoItemDao: TodoItemQueryDao;

  public constructor({ todoItemDao }: DefaultTodoQueryServiceDeps) {
    this.todoItemDao = todoItemDao;
  }

  public async queryList(query: TodoListQuery): Promise<TodoListResponse> {
    const input = {
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    };

    const [total, items] = await Promise.all([
      this.todoItemDao.countByQuery(input),
      this.todoItemDao.listPage(input),
    ]);

    return mapTodoList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
