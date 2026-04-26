/**
 * Queue: a generic FIFO queue with both immediate and suspending consumer
 * APIs. Producers are always immediate; consumers pick the variant that
 * fits their use case.
 *
 * Method semantics:
 * - enqueue(item) is immediate. Pushes the item onto the tail and wakes
 *   any consumers currently awaiting waitNonEmpty() or take().
 * - dequeue() is immediate. Pops and returns the next item, or null if
 *   the queue is empty.
 * - take() suspends until the queue is non-empty, then pops and returns
 *   the next item. Composes waitNonEmpty + dequeue into one step.
 * - waitNonEmpty() suspends until the queue transitions from empty to
 *   non-empty (or returns immediately if already non-empty). It does NOT
 *   consume the item. Callers are expected to dequeue() themselves
 *   afterwards if they want it.
 *
 * Two consumer styles, both supported:
 *
 * 1. ReAct loop / suspending-tool style: a tool wants to suspend until any
 *    producer enqueues something, but consumption is handled by the next
 *    round's drain step. Use waitNonEmpty() + dequeue().
 *
 * 2. Actor / single-worker style: a worker loop consumes one item at a
 *    time from the queue. Use take() in a `while (true) { handle(await
 *    take()) }` loop.
 *
 * Wake-up generality: any producer can unblock the consumer. A setTimeout
 * that enqueues a synthetic item is indistinguishable from a real item
 * arriving. There is no separate "timer channel" required.
 */
export interface Queue<T> {
  enqueue(item: T): number;
  dequeue(): T | null;
  take(): Promise<T>;
  size(): number;
  clear(): number;
  waitNonEmpty(): Promise<void>;
}

export class InMemoryQueue<T> implements Queue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<() => void> = [];

  public enqueue(item: T): number {
    this.items.push(item);
    // Wake all currently-suspended consumers. Each one will re-enter
    // waitNonEmpty() / take() for its next iteration on its own schedule.
    const toWake = this.waiters.splice(0);
    for (const wake of toWake) {
      wake();
    }
    return this.items.length;
  }

  public dequeue(): T | null {
    return this.items.shift() ?? null;
  }

  public async take(): Promise<T> {
    while (true) {
      const item = this.dequeue();
      if (item !== null) {
        return item;
      }
      await this.waitNonEmpty();
    }
  }

  public size(): number {
    return this.items.length;
  }

  public clear(): number {
    const cleared = this.items.length;
    this.items.length = 0;
    return cleared;
  }

  public waitNonEmpty(): Promise<void> {
    if (this.items.length > 0) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }
}
