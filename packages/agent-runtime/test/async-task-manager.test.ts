import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncTaskManager, type AsyncTaskCompletion } from "../src/async-task-manager.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("AsyncTaskManager", () => {
  it("submit 同步返回 taskId，绝不 await run（注入永不 resolve 的 run 也立即返回）", () => {
    const completions: AsyncTaskCompletion[] = [];
    const manager = new AsyncTaskManager({
      maxTaskDurationMs: 60_000,
      onComplete: c => completions.push(c),
      generateId: () => "t1",
    });

    const { taskId } = manager.submit({
      toolName: "demo",
      run: () => new Promise<string>(() => {}),
    });

    expect(taskId).toBe("t1");
    expect(completions).toHaveLength(0);
    expect(manager.inFlightCount()).toBe(1);
  });

  it("成功：onComplete 恰好一次 success，content 透传", async () => {
    let resolveDone: (c: AsyncTaskCompletion) => void = () => {};
    const done = new Promise<AsyncTaskCompletion>(r => {
      resolveDone = r;
    });
    const manager = new AsyncTaskManager({
      maxTaskDurationMs: 60_000,
      onComplete: c => resolveDone(c),
      generateId: () => "t1",
    });

    manager.submit({ toolName: "demo", run: async () => "结果X" });

    const c = await done;
    expect(c).toEqual({
      taskId: "t1",
      toolName: "demo",
      outcome: { status: "success", content: "结果X" },
    });
    expect(manager.inFlightCount()).toBe(0);
  });

  it("成功带图：run 返回 {content, images} → outcome 透传 images", async () => {
    let resolveDone: (c: AsyncTaskCompletion) => void = () => {};
    const done = new Promise<AsyncTaskCompletion>(r => {
      resolveDone = r;
    });
    const manager = new AsyncTaskManager({
      maxTaskDurationMs: 60_000,
      onComplete: c => resolveDone(c),
      generateId: () => "t1",
    });

    manager.submit({
      toolName: "gen",
      run: async () => ({
        content: "done",
        images: [{ content: "B64", mimeType: "image/png", filename: "x.png" }],
      }),
    });

    const c = await done;
    expect(c.outcome).toEqual({
      status: "success",
      content: "done",
      images: [{ content: "B64", mimeType: "image/png", filename: "x.png" }],
    });
  });

  it("成功空图：run 返回 {content, images:[]} → outcome 不含 images 键", async () => {
    let resolveDone: (c: AsyncTaskCompletion) => void = () => {};
    const done = new Promise<AsyncTaskCompletion>(r => {
      resolveDone = r;
    });
    const manager = new AsyncTaskManager({
      maxTaskDurationMs: 60_000,
      onComplete: c => resolveDone(c),
      generateId: () => "t1",
    });

    manager.submit({ toolName: "gen", run: async () => ({ content: "done", images: [] }) });

    const c = await done;
    expect(c.outcome).toEqual({ status: "success", content: "done" });
    expect("images" in c.outcome).toBe(false);
  });

  it("错误：onComplete 恰好一次 error，带错误信息", async () => {
    let resolveDone: (c: AsyncTaskCompletion) => void = () => {};
    const done = new Promise<AsyncTaskCompletion>(r => {
      resolveDone = r;
    });
    const manager = new AsyncTaskManager({
      maxTaskDurationMs: 60_000,
      onComplete: c => resolveDone(c),
      generateId: () => "t1",
    });

    manager.submit({
      toolName: "demo",
      run: async () => {
        throw new Error("boom");
      },
    });

    const c = await done;
    expect(c).toEqual({
      taskId: "t1",
      toolName: "demo",
      outcome: { status: "error", message: "boom" },
    });
    expect(manager.inFlightCount()).toBe(0);
  });

  it("超时：过 maxTaskDurationMs 后 onComplete 一次 timeout；run 之后 resolve 不触发第二次", async () => {
    vi.useFakeTimers();
    const completions: AsyncTaskCompletion[] = [];
    const manager = new AsyncTaskManager({
      maxTaskDurationMs: 500,
      onComplete: c => completions.push(c),
      generateId: () => "t1",
    });

    manager.submit({
      toolName: "demo",
      run: () => new Promise<string>(resolve => setTimeout(() => resolve("迟到的成功"), 1_000)),
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(completions).toEqual([
      { taskId: "t1", toolName: "demo", outcome: { status: "timeout" } },
    ]);
    expect(manager.inFlightCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(600); // run 此时才 resolve
    expect(completions).toHaveLength(1);
  });

  it("超时晚到不泄漏：超时后 run reject 不触发第二次 onComplete", async () => {
    vi.useFakeTimers();
    const completions: AsyncTaskCompletion[] = [];
    const manager = new AsyncTaskManager({
      maxTaskDurationMs: 500,
      onComplete: c => completions.push(c),
      generateId: () => "t1",
    });

    manager.submit({
      toolName: "demo",
      run: () =>
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("late")), 1_000)),
    });

    await vi.advanceTimersByTimeAsync(500);
    expect(completions).toEqual([
      { taskId: "t1", toolName: "demo", outcome: { status: "timeout" } },
    ]);

    await vi.advanceTimersByTimeAsync(600); // run 此时才 reject，应被吞掉
    expect(completions).toHaveLength(1);
  });

  it("并发：N 个任务各 onComplete 恰好一次，taskId 互异", async () => {
    const completions: AsyncTaskCompletion[] = [];
    let remaining = 3;
    let resolveAll: () => void = () => {};
    const all = new Promise<void>(r => {
      resolveAll = r;
    });
    let n = 0;
    const manager = new AsyncTaskManager({
      maxTaskDurationMs: 60_000,
      generateId: () => `t${++n}`,
      onComplete: c => {
        completions.push(c);
        remaining -= 1;
        if (remaining === 0) {
          resolveAll();
        }
      },
    });

    manager.submit({ toolName: "a", run: async () => "ra" });
    manager.submit({ toolName: "b", run: async () => "rb" });
    manager.submit({ toolName: "c", run: async () => "rc" });

    await all;
    const ids = completions.map(c => c.taskId).sort();
    expect(ids).toEqual(["t1", "t2", "t3"]);
    expect(completions).toHaveLength(3);
    expect(manager.inFlightCount()).toBe(0);
  });
});
