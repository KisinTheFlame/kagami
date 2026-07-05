import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import type { TodoService } from "../../../capabilities/todo/application/todo.service.js";

const COMPLETE_TODO_TOOL_NAME = "complete_todo";

const CompleteTodoArgumentsSchema = z.object({
  id: z.number().int().positive(),
});

type CompleteTodoToolDeps = {
  getTodoService: () => TodoService;
};

/** 标记一条待办完成（移出提醒序列）。返回一行紧凑确认。 */
export class CompleteTodoTool extends ZodToolComponent<typeof CompleteTodoArgumentsSchema> {
  public readonly name = COMPLETE_TODO_TOOL_NAME;
  public readonly description =
    "标记一条待办为已完成（按 id）。只能在 todo App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: { type: "number", description: "待办 id，来自 list_todos。" },
    },
    required: ["id"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = CompleteTodoArgumentsSchema;

  private readonly getTodoService: () => TodoService;

  public constructor({ getTodoService }: CompleteTodoToolDeps) {
    super();
    this.getTodoService = getTodoService;
  }

  protected async executeTyped(
    input: z.infer<typeof CompleteTodoArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    const ok = await this.getTodoService().completeTodo({ id: input.id });
    return ok
      ? { content: JSON.stringify({ ok: true, message: `已完成 #${input.id}` }) }
      : { content: JSON.stringify({ ok: false, error: "TODO_NOT_FOUND" }) };
  }
}
