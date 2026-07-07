import type { App } from "@kagami/agent-runtime";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";
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
  public readonly description = "管理自己的待办，记事、改状态、设到点和周期提醒。";
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
    return renderServerStaticTemplate(import.meta.url, "prompts/todo-app-help.hbs");
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
