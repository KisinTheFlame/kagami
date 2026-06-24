import { describe, expect, it } from "vitest";
import { SerialExecutor } from "../src/serial-executor.js";

describe("SerialExecutor", () => {
  it("严格串行：任务按提交顺序执行且不交错", async () => {
    const executor = new SerialExecutor();
    const order: string[] = [];

    const makeTask = (id: string) => async () => {
      order.push(`start-${id}`);
      // 多个微任务 tick，给交错留出机会；串行保证下一个任务不会在此期间插入。
      await Promise.resolve();
      await Promise.resolve();
      order.push(`end-${id}`);
      return id;
    };

    const results = await Promise.all([
      executor.submit(makeTask("a")),
      executor.submit(makeTask("b")),
      executor.submit(makeTask("c")),
    ]);

    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b", "start-c", "end-c"]);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("submit 返回的 promise resolve 为该任务的返回值", async () => {
    const executor = new SerialExecutor();

    await expect(executor.submit(async () => 42)).resolves.toBe(42);
  });

  it("一个任务抛错只影响它自己的 caller，不影响后续任务", async () => {
    const executor = new SerialExecutor();
    const order: string[] = [];

    const failing = executor.submit(async () => {
      order.push("failing");
      throw new Error("boom");
    });
    const following = executor.submit(async () => {
      order.push("following");
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    await expect(following).resolves.toBe("ok");
    expect(order).toEqual(["failing", "following"]);
  });

  it("队列排空后再 submit 能重新启动 worker", async () => {
    const executor = new SerialExecutor();

    await expect(executor.submit(async () => "first")).resolves.toBe("first");
    expect(executor.size()).toBe(0);

    await expect(executor.submit(async () => "second")).resolves.toBe("second");
  });
});
