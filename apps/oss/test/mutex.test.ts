import { describe, expect, it } from "vitest";
import { Mutex } from "../src/store/mutex.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("Mutex", () => {
  it("returns the task's resolved value", async () => {
    const mutex = new Mutex();
    await expect(mutex.run(async () => 42)).resolves.toBe(42);
  });

  it("serializes tasks in submission order even when a later one would finish first", async () => {
    const mutex = new Mutex();
    const log: string[] = [];
    const gateA = deferred<void>();

    // A 提交在先但卡在 gateA；B 提交在后、本身瞬时完成。
    const a = mutex.run(async () => {
      log.push("a:start");
      await gateA.promise;
      log.push("a:end");
    });
    const b = mutex.run(async () => {
      log.push("b:start");
      log.push("b:end");
    });

    // A 未结束前，B 绝不能插队开始（这正是写锁要保证的串行性）。
    await flushMicrotasks();
    expect(log).toEqual(["a:start"]);

    gateA.resolve();
    await Promise.all([a, b]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("keeps the chain alive after a task throws (a rejected task doesn't poison the lock)", async () => {
    const mutex = new Mutex();
    await expect(
      mutex.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(mutex.run(async () => "ok")).resolves.toBe("ok");
  });
});
