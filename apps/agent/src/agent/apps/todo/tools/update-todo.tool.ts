import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { InvalidTimeError } from "../../../capabilities/todo/application/parse-reminder-time.js";
import type { TodoService } from "../../../capabilities/todo/application/todo.service.js";

const UPDATE_TODO_TOOL_NAME = "update_todo";

const UpdateTodoArgumentsSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1).optional(),
    note: z.string().optional(),
    remindAt: z.string().min(1).optional(),
    repeatEvery: z.string().min(1).optional(),
  })
  .refine(
    input =>
      input.title !== undefined ||
      input.note !== undefined ||
      input.remindAt !== undefined ||
      input.repeatEvery !== undefined,
    { message: "至少要改一个字段（title/note/remindAt/repeatEvery）" },
  );

type UpdateTodoToolDeps = {
  getTodoService: () => TodoService;
};

/** 修改一条 pending 待办的字段。仅作用于未完成项，字段走与 add 相同的校验。 */
export class UpdateTodoTool extends ZodToolComponent<typeof UpdateTodoArgumentsSchema> {
  public readonly name = UPDATE_TODO_TOOL_NAME;
  public readonly description =
    "修改一条未完成待办的字段（title/note/remindAt/repeatEvery，按 id）。只能在 todo App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: { type: "number", description: "待办 id。" },
      title: { type: "string", description: "新标题。" },
      note: { type: "string", description: "新备注（传空串可清空）。" },
      remindAt: { type: "string", description: "新提醒时间，相对时长或 ISO。" },
      repeatEvery: { type: "string", description: '新重复间隔，如 "1d"。' },
    },
    required: ["id"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = UpdateTodoArgumentsSchema;

  private readonly getTodoService: () => TodoService;

  public constructor({ getTodoService }: UpdateTodoToolDeps) {
    super();
    this.getTodoService = getTodoService;
  }

  protected async executeTyped(
    input: z.infer<typeof UpdateTodoArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    try {
      const ok = await this.getTodoService().updateTodo(input);
      return ok
        ? { content: JSON.stringify({ ok: true }) }
        : { content: JSON.stringify({ ok: false, error: "TODO_NOT_FOUND" }) };
    } catch (error) {
      if (error instanceof InvalidTimeError) {
        return {
          content: JSON.stringify({ ok: false, error: "INVALID_TIME", reason: error.reason }),
        };
      }
      throw error;
    }
  }
}
