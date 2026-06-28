import type { App } from "@kagami/agent-runtime";
import { TODO_LIST_RENDER_LIMIT } from "../../capabilities/todo/application/todo.constants.js";
import type { TodoService } from "../../capabilities/todo/application/todo.service.js";
import type { RootAgentEffect } from "../../runtime/effect/root-agent-effect.js";
import { renderTodoListContent } from "./render-todo-list.js";
import { AddTodoTool } from "./tools/add-todo.tool.js";
import { CompleteTodoTool } from "./tools/complete-todo.tool.js";
import { ListTodosTool } from "./tools/list-todos.tool.js";
import { RemoveTodoTool } from "./tools/remove-todo.tool.js";
import { SnoozeTodoTool } from "./tools/snooze-todo.tool.js";
import { UpdateTodoTool } from "./tools/update-todo.tool.js";

export const TODO_APP_ID = "todo";

type TodoAppDeps = {
  todoService: TodoService;
};

/**
 * 待办 App。小镜自己的中立待办本：CRUD + 到点/每日提醒（提醒线由 capabilities 层的
 * TodoReminderPoller 经 NotificationCenter 走，不在 App 内）。
 *
 * - 工具：add_todo / list_todos / complete_todo / snooze_todo / update_todo / remove_todo
 * - mutation 工具返回一行紧凑确认，不回贴整张清单（守 context-growth 红线）
 * - onFocus 列一次 pending（一次性、有界），不重复刷
 * - 共享 TodoService 由 factory 装配（poller / digest 也用同一实例），App 只持引用、闭包注入工具
 */
export class TodoApp implements App {
  public readonly id = TODO_APP_ID;
  public readonly displayName = "待办";
  public readonly tools: readonly [
    AddTodoTool,
    ListTodosTool,
    CompleteTodoTool,
    SnoozeTodoTool,
    UpdateTodoTool,
    RemoveTodoTool,
  ];

  private readonly todoService: TodoService;

  public constructor({ todoService }: TodoAppDeps) {
    this.todoService = todoService;
    const getTodoService = (): TodoService => this.todoService;
    this.tools = [
      new AddTodoTool({ getTodoService }),
      new ListTodosTool({ getTodoService }),
      new CompleteTodoTool({ getTodoService }),
      new SnoozeTodoTool({ getTodoService }),
      new UpdateTodoTool({ getTodoService }),
      new RemoveTodoTool({ getTodoService }),
    ];
  }

  public canInvoke(): boolean {
    return true;
  }

  public async help(): Promise<string> {
    return [
      "你在待办 App 里。这是你自己的待办本，想怎么用都行。",
      "",
      "可调用工具：",
      "  - add_todo(title, note, remindAt, repeatEvery?): 记一条。note、remindAt 必填；remindAt/repeatEvery 收相对时长（30m/1d）或 ISO。",
      "  - list_todos(filter?): 列出待办（pending 默认 / all / done）。",
      "  - complete_todo(id): 标记完成。",
      "  - snooze_todo(id, until? | forMinutes?): 稍后再提醒。",
      "  - update_todo(id, ...): 改未完成项的字段。",
      "  - remove_todo(id): 删除（soft delete）。",
      "",
      "设了 remindAt 的待办到点会通过通知提醒你；设了 repeatEvery 会按周期反复提醒。",
      "调 back_to_portal 退出本 App 回到桌面。",
    ].join("\n");
  }

  /** 进入 App 时列一次 pending 清单，作为 append_message Effect 追加到上下文尾部。 */
  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    const view = await this.todoService.listView({
      filter: "pending",
      limit: TODO_LIST_RENDER_LIMIT,
    });
    const content = renderTodoListContent({
      heading: view.heading,
      todos: view.todos,
      hiddenCount: view.total - view.todos.length,
    });
    return [{ type: "append_message", content }];
  }
}
