import { describe, expect, it } from "vitest";
import { SerialExecutor } from "../src/application/serial-executor.js";

describe("SerialExecutor", () => {
  it("把并发提交的任务串行化执行（任一时刻只有一个在跑）", async () => {
    const serial = new SerialExecutor();
    let running = 0;
    let maxConcurrent = 0;
    const order: number[] = [];

    const make = (id: number) => async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      order.push(id);
      running -= 1;
      return id;
    };

    // 同步并发提交 3 个任务。
    const results = await Promise.all([
      serial.run(make(1)),
      serial.run(make(2)),
      serial.run(make(3)),
    ]);

    expect(maxConcurrent).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("某个任务失败不毒死后续任务（链继续）", async () => {
    const serial = new SerialExecutor();
    const ran: number[] = [];

    const first = serial.run(async () => {
      ran.push(1);
      throw new Error("boom");
    });
    const second = serial.run(async () => {
      ran.push(2);
      return "ok";
    });

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(ran).toEqual([1, 2]);
  });
});
