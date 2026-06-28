import { describe, expect, it } from "vitest";
import { TodoService } from "../../../../src/agent/capabilities/todo/application/todo.service.js";
import { TodoApp, TODO_APP_ID } from "../../../../src/agent/apps/todo/todo.app.js";
import { InMemoryTodoDao } from "../../../helpers/in-memory-todo.dao.js";

function setupApp() {
  const now = (): Date => new Date("2026-06-27T00:00:00.000Z");
  const service = new TodoService({ todoDao: new InMemoryTodoDao(now), now });
  return { service, app: new TodoApp({ todoService: service }) };
}

describe("TodoApp", () => {
  it("声明 6 个工具，id=todo，canInvoke 恒 true", () => {
    const { app } = setupApp();
    expect(app.id).toBe(TODO_APP_ID);
    expect(app.tools.map(t => t.name)).toEqual([
      "add_todo",
      "list_todos",
      "complete_todo",
      "snooze_todo",
      "update_todo",
      "remove_todo",
    ]);
    expect(app.canInvoke()).toBe(true);
  });

  it("help 列出全部工具", async () => {
    const { app } = setupApp();
    const help = await app.help();
    for (const name of [
      "add_todo",
      "list_todos",
      "complete_todo",
      "snooze_todo",
      "update_todo",
      "remove_todo",
    ]) {
      expect(help).toContain(name);
    }
  });

  it("onFocus 列一次 pending，产 append_message Effect", async () => {
    const { service, app } = setupApp();
    await service.addTodo({ title: "甲" });
    const effects = await app.onFocus();
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ type: "append_message" });
    expect((effects[0] as { content: string }).content).toContain("#1 甲");
  });
});
