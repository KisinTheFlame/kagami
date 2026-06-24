import { describe, expect, it } from "vitest";
import { InMemoryQueue } from "../src/queue.js";

/** 等一个微任务 tick，让已 resolve 的 promise 回调跑完，再断言唤醒状态。 */
function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe("InMemoryQueue", () => {
  it("严格 FIFO：dequeue 顺序等于 enqueue 顺序", () => {
    const queue = new InMemoryQueue<string>();
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    expect(queue.dequeue()).toBe("a");
    expect(queue.dequeue()).toBe("b");
    expect(queue.dequeue()).toBe("c");
  });

  it("enqueue 返回入队后的长度", () => {
    const queue = new InMemoryQueue<string>();

    expect(queue.enqueue("a")).toBe(1);
    expect(queue.enqueue("b")).toBe(2);
  });

  it("空队列 dequeue 返回 null", () => {
    const queue = new InMemoryQueue<string>();

    expect(queue.dequeue()).toBeNull();
  });

  it("clear 清空并返回被清掉的数量", () => {
    const queue = new InMemoryQueue<string>();
    queue.enqueue("a");
    queue.enqueue("b");

    expect(queue.clear()).toBe(2);
    expect(queue.size()).toBe(0);
    expect(queue.dequeue()).toBeNull();
  });

  it("take 在队列非空时立即返回，且保持 FIFO", async () => {
    const queue = new InMemoryQueue<string>();
    queue.enqueue("a");
    queue.enqueue("b");

    await expect(queue.take()).resolves.toBe("a");
    await expect(queue.take()).resolves.toBe("b");
  });

  it("take 在队列为空时挂起，直到 enqueue 才 resolve", async () => {
    const queue = new InMemoryQueue<string>();

    let resolved = false;
    const taken = queue.take().then(value => {
      resolved = true;
      return value;
    });

    await flushMicrotasks();
    expect(resolved).toBe(false);

    queue.enqueue("x");
    await expect(taken).resolves.toBe("x");
  });

  it("一次 enqueue 唤醒全部挂起的 waiter（wake-all 语义）", async () => {
    const queue = new InMemoryQueue<string>();

    let woken = 0;
    const w1 = queue.waitNonEmpty().then(() => {
      woken += 1;
    });
    const w2 = queue.waitNonEmpty().then(() => {
      woken += 1;
    });

    await flushMicrotasks();
    expect(woken).toBe(0);

    queue.enqueue("x");
    await Promise.all([w1, w2]);
    expect(woken).toBe(2);
  });

  it("waitNonEmpty 在队列已非空时立即 resolve", async () => {
    const queue = new InMemoryQueue<string>();
    queue.enqueue("a");

    await expect(queue.waitNonEmpty()).resolves.toBeUndefined();
  });
});
