import { z } from "zod";
import { ZodToolComponent, type ToolExecutionResult, type ToolKind } from "@kagami/agent-runtime";
import { InvalidTimeError } from "../../../capabilities/todo/application/parse-reminder-time.js";
import type { TodoService } from "../../../capabilities/todo/application/todo.service.js";

const SNOOZE_TODO_TOOL_NAME = "snooze_todo";

const SnoozeTodoArgumentsSchema = z.object({
  id: z.number().int().positive(),
  until: z.string().min(1).optional(),
  forMinutes: z.number().positive().optional(),
});

type SnoozeTodoToolDeps = {
  getTodoService: () => TodoService;
};

/** 稍后再提醒（推迟某条待办的提醒）。恰好给 until 或 forMinutes 之一。 */
export class SnoozeTodoTool extends ZodToolComponent<typeof SnoozeTodoArgumentsSchema> {
  public readonly name = SNOOZE_TODO_TOOL_NAME;
  public readonly description =
    "推迟一条待办的提醒（稍后再提醒）。until=绝对/相对时间，或 forMinutes=多少分钟后；二选一。只能在 todo App 里通过 invoke 调用。";
  public readonly parameters = {
    type: "object",
    properties: {
      id: { type: "number", description: "待办 id。" },
      until: { type: "string", description: '推迟到的时间，相对时长如 "2h" 或 ISO 绝对时间。' },
      forMinutes: { type: "number", description: "多少分钟后再提醒。" },
    },
    required: ["id"],
  } as const;
  public readonly kind: ToolKind = "business";
  protected readonly inputSchema = SnoozeTodoArgumentsSchema;

  private readonly getTodoService: () => TodoService;

  public constructor({ getTodoService }: SnoozeTodoToolDeps) {
    super();
    this.getTodoService = getTodoService;
  }

  protected async executeTyped(
    input: z.infer<typeof SnoozeTodoArgumentsSchema>,
  ): Promise<ToolExecutionResult> {
    try {
      const ok = await this.getTodoService().snoozeTodo(input);
      return ok
        ? { content: JSON.stringify({ ok: true, message: `已推迟 #${input.id}` }) }
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
