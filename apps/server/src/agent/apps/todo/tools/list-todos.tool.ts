import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { TODO_LIST_RENDER_LIMIT } from "../../../capabilities/todo/application/todo.constants.js";
import type { TodoService } from "../../../capabilities/todo/application/todo.service.js";
import { renderTodoListContent } from "../render-todo-list.js";

export const LIST_TODOS_TOOL_NAME = "list_todos";

const ListTodosArgumentsSchema = z.object({
  filter: z.enum(["pending", "all", "done"]).optional(),
});

type ListTodosToolDeps = {
  getTodoService: () => TodoService;
};

/**
 * 列出待办。默认 pending；输出封顶（超出附「其余 N 件」），避免 completed 累积撑大上下文。
 * 列表直接作为 tool_result 返回（按需、有界），不走 append_message。
 */
export class ListTodosTool extends ZodToolComponent<typeof ListTodosArgumentsSchema> {
  public readonly name = LIST_TODOS_TOOL_NAME;
  public readonly description =
    "列出待办。filter: pending（默认）/ all / done。输出封顶。只能在 todo App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      filter: {
        type: "string",
        enum: ["pending", "all", "done"],
        description: "pending=未完成（默认），done=已完成，all=两者。",
      },
    },
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = ListTodosArgumentsSchema;

  private readonly getTodoService: () => TodoService;

  public constructor({ getTodoService }: ListTodosToolDeps) {
    super();
    this.getTodoService = getTodoService;
  }

  protected async executeTyped(
    input: z.infer<typeof ListTodosArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const view = await this.getTodoService().listView({
      filter: input.filter ?? "pending",
      limit: TODO_LIST_RENDER_LIMIT,
    });
    const content = renderTodoListContent({
      heading: view.heading,
      todos: view.todos,
      hiddenCount: view.total - view.todos.length,
    });
    return { content };
  }
}
