import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AsyncTaskManager } from "../src/async-task-manager.js";
import { AsyncTool, formatAsyncTaskSubmitted } from "../src/tool/async-tool.js";

const inputSchema = z.object({ x: z.string() });
const parameters = {
  type: "object",
  properties: { x: { type: "string" } },
} as const;

function makeManager() {
  return new AsyncTaskManager({
    maxTaskDurationMs: 60_000,
    onComplete: () => {},
    generateId: () => "tid",
  });
}

describe("AsyncTool", () => {
  it("submit 路径：产标准占位 + 把 toolName/run 交给 manager.submit", async () => {
    const manager = makeManager();
    const submitSpy = vi.spyOn(manager, "submit");
    const tool = new AsyncTool({
      name: "demo",
      description: "d",
      parameters,
      inputSchema,
      asyncTaskManager: manager,
      prepareAsync: input => ({ kind: "submit", run: async () => `ran:${input.x}` }),
    });

    const result = await tool.execute({ x: "hi" }, {});

    expect(result.content).toBe('<async_task_submitted task_id="tid" tool="demo" />');
    expect(submitSpy).toHaveBeenCalledWith({ toolName: "demo", run: expect.any(Function) });
  });

  it("reject 路径：原样返回 content，不调用 manager.submit", async () => {
    const manager = makeManager();
    const submitSpy = vi.spyOn(manager, "submit");
    const tool = new AsyncTool({
      name: "demo",
      description: "d",
      parameters,
      inputSchema,
      asyncTaskManager: manager,
      prepareAsync: () => ({ kind: "reject", content: "NOPE" }),
    });

    const result = await tool.execute({ x: "hi" }, {});

    expect(result.content).toBe("NOPE");
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("非法入参在 execute 层被拒，prepareAsync 不被调用", async () => {
    const manager = makeManager();
    const prepareAsync = vi.fn(() => ({ kind: "reject" as const, content: "x" }));
    const tool = new AsyncTool({
      name: "demo",
      description: "d",
      parameters,
      inputSchema,
      asyncTaskManager: manager,
      prepareAsync,
    });

    const result = await tool.execute({}, {});

    expect(JSON.parse(result.content)).toMatchObject({ ok: false, error: "INVALID_ARGUMENTS" });
    expect(prepareAsync).not.toHaveBeenCalled();
  });

  it("formatAsyncTaskSubmitted 产纯结构化标签", () => {
    expect(formatAsyncTaskSubmitted("abc", "search_web")).toBe(
      '<async_task_submitted task_id="abc" tool="search_web" />',
    );
  });
});
