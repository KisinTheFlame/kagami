import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import type { TodoService } from "../../../capabilities/todo/application/todo.service.js";

const REMOVE_TODO_TOOL_NAME = "remove_todo";

const RemoveTodoArgumentsSchema = z.object({
  id: z.number().int().positive(),
});

type RemoveTodoToolDeps = {
  getTodoService: () => TodoService;
};

/** 删除一条待办（soft delete，置 removed）。返回一行紧凑确认。 */
export class RemoveTodoTool extends ZodToolComponent<typeof RemoveTodoArgumentsSchema> {
  public readonly name = REMOVE_TODO_TOOL_NAME;
  public readonly description =
    "删除一条待办（按 id，soft delete）。只能在 todo App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: { type: "number", description: "待办 id，来自 list_todos。" },
    },
    required: ["id"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = RemoveTodoArgumentsSchema;

  private readonly getTodoService: () => TodoService;

  public constructor({ getTodoService }: RemoveTodoToolDeps) {
    super();
    this.getTodoService = getTodoService;
  }

  protected async executeTyped(
    input: z.infer<typeof RemoveTodoArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const ok = await this.getTodoService().removeTodo({ id: input.id });
    return ok
      ? { content: JSON.stringify({ ok: true, message: `已删除 #${input.id}` }) }
      : { content: JSON.stringify({ ok: false, error: "TODO_NOT_FOUND" }) };
  }
}
