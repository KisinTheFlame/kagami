import type { TodoRecord } from "../../capabilities/todo/application/todo.dao.js";

/**
 * 把一批待办渲染成一段 `<todo_list>` 屏幕文本，供 onFocus 的 append_message 与
 * list_todos 工具结果共用。已由调用方封顶；`hiddenCount>0` 时附「其余 N 件」。
 */
export function renderTodoListContent(input: {
  heading: string;
  todos: TodoRecord[];
  hiddenCount: number;
}): string {
  const lines: string[] = ["<todo_list>", input.heading];
  if (input.todos.length === 0) {
    lines.push("（空）");
  } else {
    for (const todo of input.todos) {
      lines.push(renderRow(todo));
    }
    if (input.hiddenCount > 0) {
      lines.push(`…其余 ${input.hiddenCount} 件`);
    }
  }
  lines.push("</todo_list>");
  return lines.join("\n");
}

function renderRow(todo: TodoRecord): string {
  const parts = [`- #${todo.id} ${todo.title}`];
  if (todo.remindAt) {
    parts.push(`⏰${formatLocalDateTime(todo.remindAt)}`);
  }
  if (todo.repeatEveryMs !== null) {
    parts.push(`🔁${formatDuration(todo.repeatEveryMs)}`);
  }
  if (todo.snoozedUntil) {
    parts.push(`💤至${formatLocalDateTime(todo.snoozedUntil)}`);
  }
  if (todo.note) {
    parts.push(`（${todo.note}）`);
  }
  return parts.join("  ");
}

function formatLocalDateTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function formatDuration(ms: number): string {
  const units: [number, string][] = [
    [86_400_000, "天"],
    [3_600_000, "小时"],
    [60_000, "分钟"],
  ];
  for (const [unitMs, label] of units) {
    if (ms % unitMs === 0) {
      return `每${ms / unitMs}${label}`;
    }
  }
  return `每${Math.round(ms / 1000)}秒`;
}
