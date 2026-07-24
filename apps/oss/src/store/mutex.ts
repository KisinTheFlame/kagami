/**
 * 极简进程内互斥锁：把异步操作串成一条链，后来的等前一个完成再跑。ObjectStore 用它串行化写操作
 * 的临界区，消除「文件 I/O 在事务外 + await 让出事件循环」导致的并发竞态。纯 Promise 编排、无 I/O。
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  public async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}
