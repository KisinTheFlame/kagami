import { type TodoListQuery, type TodoListResponse } from "@kagami/console-api/todo";

export interface TodoQueryService {
  queryList(query: TodoListQuery): Promise<TodoListResponse>;
}
