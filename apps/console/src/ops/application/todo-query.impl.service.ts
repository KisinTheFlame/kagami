import { type TodoListQuery, type TodoListResponse } from "@kagami/console-api/todo";
import type { TodoQueryService } from "./todo-query.service.js";
import { mapTodoList } from "../mappers/todo.mapper.js";
import type { AgentOpsQueryClient } from "./app-log-query.impl.service.js";

type DefaultTodoQueryServiceDeps = {
  agentOpsQueryClient: AgentOpsQueryClient;
};

/**
 * todo_item 查询：epic #539 子 issue 4 起 console 不再直读主库，改经 agent 契约路由查询。
 */
export class DefaultTodoQueryService implements TodoQueryService {
  private readonly agentOpsQueryClient: AgentOpsQueryClient;

  public constructor({ agentOpsQueryClient }: DefaultTodoQueryServiceDeps) {
    this.agentOpsQueryClient = agentOpsQueryClient;
  }

  public async queryList(query: TodoListQuery): Promise<TodoListResponse> {
    const { total, items } = await this.agentOpsQueryClient.queryTodos({
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });

    return mapTodoList({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items,
    });
  }
}
