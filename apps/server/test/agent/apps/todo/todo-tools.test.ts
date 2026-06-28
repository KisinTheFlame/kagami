import { describe, expect, it } from "vitest";
import type { ToolComponent } from "@kagami/agent-runtime";
import { TodoService } from "../../../../src/agent/capabilities/todo/application/todo.service.js";
import { AddTodoTool } from "../../../../src/agent/apps/todo/tools/add-todo.tool.js";
import { ListTodosTool } from "../../../../src/agent/apps/todo/tools/list-todos.tool.js";
import { CompleteTodoTool } from "../../../../src/agent/apps/todo/tools/complete-todo.tool.js";
import { SnoozeTodoTool } from "../../../../src/agent/apps/todo/tools/snooze-todo.tool.js";
import { UpdateTodoTool } from "../../../../src/agent/apps/todo/tools/update-todo.tool.js";
import { RemoveTodoTool } from "../../../../src/agent/apps/todo/tools/remove-todo.tool.js";
import { InMemoryTodoDao } from "../../../helpers/in-memory-todo.dao.js";

function setup() {
  const now = (): Date => new Date("2026-06-27T00:00:00.000Z");
  const dao = new InMemoryTodoDao(now);
  const service = new TodoService({ todoDao: dao, now });
  const getTodoService = (): TodoService => service;
  return { dao, service, getTodoService };
}

async function run(tool: ToolComponent, args: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(args, {});
  return JSON.parse(result.content);
}

describe("AddTodoTool", () => {
  it("happy → ok + message", async () => {
    const { getTodoService } = setup();
    const out = await run(new AddTodoTool({ getTodoService }), {
      title: "写周报",
      note: "本周进展汇总",
      remindAt: "1h",
    });
    expect(out).toMatchObject({ ok: true, id: 1 });
  });

  it("缺 title → INVALID_ARGUMENTS（Zod 边界）", async () => {
    const { getTodoService } = setup();
    const out = await run(new AddTodoTool({ getTodoService }), {});
    expect(out).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });

  it("缺 note → INVALID_ARGUMENTS（Zod 边界）", async () => {
    const { getTodoService } = setup();
    const out = await run(new AddTodoTool({ getTodoService }), { title: "x", remindAt: "1h" });
    expect(out).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });

  it("缺 remindAt → INVALID_ARGUMENTS（Zod 边界）", async () => {
    const { getTodoService } = setup();
    const out = await run(new AddTodoTool({ getTodoService }), { title: "x", note: "n" });
    expect(out).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
  });

  it("过去 remindAt → INVALID_TIME", async () => {
    const { getTodoService } = setup();
    const out = await run(new AddTodoTool({ getTodoService }), {
      title: "x",
      note: "n",
      remindAt: "2020-01-01T00:00:00.000Z",
    });
    expect(out).toMatchObject({ ok: false, error: "INVALID_TIME" });
  });
});

describe("ListTodosTool", () => {
  it("返回 <todo_list> 屏幕文本", async () => {
    const { service, getTodoService } = setup();
    await service.addTodo({ title: "甲" });
    const result = await new ListTodosTool({ getTodoService }).execute({}, {});
    expect(result.content).toContain("<todo_list>");
    expect(result.content).toContain("#1 甲");
  });
});

describe("CompleteTodoTool", () => {
  it("happy → ok", async () => {
    const { service, getTodoService } = setup();
    await service.addTodo({ title: "甲" });
    expect(await run(new CompleteTodoTool({ getTodoService }), { id: 1 })).toMatchObject({
      ok: true,
    });
  });

  it("不存在 → TODO_NOT_FOUND", async () => {
    const { getTodoService } = setup();
    expect(await run(new CompleteTodoTool({ getTodoService }), { id: 99 })).toMatchObject({
      ok: false,
      error: "TODO_NOT_FOUND",
    });
  });
});

describe("SnoozeTodoTool", () => {
  it("happy → ok", async () => {
    const { service, getTodoService } = setup();
    await service.addTodo({ title: "甲", remindAt: "1h" });
    expect(
      await run(new SnoozeTodoTool({ getTodoService }), { id: 1, forMinutes: 30 }),
    ).toMatchObject({ ok: true });
  });

  it("两个时间参数都给 → INVALID_TIME", async () => {
    const { service, getTodoService } = setup();
    await service.addTodo({ title: "甲", remindAt: "1h" });
    expect(
      await run(new SnoozeTodoTool({ getTodoService }), { id: 1, until: "2h", forMinutes: 30 }),
    ).toMatchObject({ ok: false, error: "INVALID_TIME" });
  });
});

describe("UpdateTodoTool", () => {
  it("happy → ok", async () => {
    const { service, getTodoService } = setup();
    await service.addTodo({ title: "甲" });
    expect(await run(new UpdateTodoTool({ getTodoService }), { id: 1, title: "乙" })).toMatchObject(
      { ok: true },
    );
  });

  it("一个字段都不改 → INVALID_ARGUMENTS（refine）", async () => {
    const { service, getTodoService } = setup();
    await service.addTodo({ title: "甲" });
    expect(await run(new UpdateTodoTool({ getTodoService }), { id: 1 })).toMatchObject({
      ok: false,
      error: "INVALID_ARGUMENTS",
    });
  });

  it("非法 remindAt → INVALID_TIME", async () => {
    const { service, getTodoService } = setup();
    await service.addTodo({ title: "甲" });
    expect(
      await run(new UpdateTodoTool({ getTodoService }), { id: 1, remindAt: "稍后" }),
    ).toMatchObject({ ok: false, error: "INVALID_TIME" });
  });
});

describe("RemoveTodoTool", () => {
  it("happy → ok；不存在 → TODO_NOT_FOUND", async () => {
    const { service, getTodoService } = setup();
    await service.addTodo({ title: "甲" });
    expect(await run(new RemoveTodoTool({ getTodoService }), { id: 1 })).toMatchObject({
      ok: true,
    });
    expect(await run(new RemoveTodoTool({ getTodoService }), { id: 1 })).toMatchObject({
      ok: false,
      error: "TODO_NOT_FOUND",
    });
  });
});
