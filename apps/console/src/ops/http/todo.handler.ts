import type { FastifyInstance } from "fastify";
import { registerJsonRoute } from "@kagami/http/register";
import { consoleApiContract } from "@kagami/console-api/contract";
import type { TodoQueryService } from "../application/todo-query.service.js";

type TodoHandlerDeps = {
  todoQueryService: TodoQueryService;
};

/** Todo 只读查询路由。路由与 schema 的单一事实源在 @kagami/console-api。 */
export class TodoHandler {
  private readonly todoQueryService: TodoQueryService;

  public constructor({ todoQueryService }: TodoHandlerDeps) {
    this.todoQueryService = todoQueryService;
  }

  public register(app: FastifyInstance): void {
    registerJsonRoute(app, consoleApiContract.queryTodos, ({ input }) =>
      this.todoQueryService.queryList(input),
    );
  }
}
