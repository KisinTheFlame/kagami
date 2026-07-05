import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { InvalidTimeError } from "../../../capabilities/todo/application/parse-reminder-time.js";
import type { TodoService } from "../../../capabilities/todo/application/todo.service.js";

const ADD_TODO_TOOL_NAME = "add_todo";

const AddTodoArgumentsSchema = z.object({
  title: z.string().min(1),
  note: z.string().min(1),
  remindAt: z.string().min(1),
  repeatEvery: z.string().min(1).optional(),
});

type AddTodoToolDeps = {
  getTodoService: () => TodoService;
};

/**
 * 记一条待办。可顺手设首次提醒（remindAt）与重复（repeatEvery）。
 * 返回一行紧凑确认，不回贴整张清单（守 context-growth 红线）。
 */
export class AddTodoTool extends ZodToolComponent<typeof AddTodoArgumentsSchema> {
  public readonly name = ADD_TODO_TOOL_NAME;
  public readonly description =
    "记一条待办。必填 note 备注、remindAt 首次提醒；可选 repeatEvery 重复间隔。时间收相对时长（如 30m/2h/1d）或 ISO 绝对时间。只能在 todo App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      title: { type: "string", description: "待办标题。" },
      note: { type: "string", description: "必填备注（来历、上下文，自由文本）。" },
      remindAt: {
        type: "string",
        description: '必填首次提醒时间。相对时长如 "30m"/"2h"/"1d"，或 ISO 绝对时间。',
      },
      repeatEvery: {
        type: "string",
        description: '可选重复间隔，如 "1d"。设了则到点后自动续期，不设则只提醒一次。',
      },
    },
    required: ["title", "note", "remindAt"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = AddTodoArgumentsSchema;

  private readonly getTodoService: () => TodoService;

  public constructor({ getTodoService }: AddTodoToolDeps) {
    super();
    this.getTodoService = getTodoService;
  }

  protected async executeTyped(
    input: z.infer<typeof AddTodoArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    try {
      const result = await this.getTodoService().addTodo(input);
      if (!result.ok) {
        return { content: JSON.stringify({ ok: false, error: "TODO_LIMIT_REACHED" }) };
      }
      return {
        content: JSON.stringify({
          ok: true,
          id: result.todo.id,
          message: `已记下《${result.todo.title}》#${result.todo.id}`,
        }),
      };
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
