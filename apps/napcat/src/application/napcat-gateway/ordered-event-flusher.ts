/**
 * 并发处理、按到达序提交的排序器。
 *
 * NapCat 的入站事件必须**按到达顺序**落库 / 广播（否则同群消息会乱序），但每条的处理
 * （vision、DB 查名片等）耗时不一、必须并发跑。做法是收到即分配一个单调递增的序号，
 * 处理完先存进 completed 表，只有轮到 `nextFlushSequence` 时才真正提交——前面的没好，
 * 后面的就先等着。
 *
 * 处理失败的那条以 null 落位：它不产生副作用，但仍然要占掉自己的序号，否则它后面的
 * 事件会被永久卡住。
 */
export class NapcatOrderedEventFlusher<TResult> {
  private nextSequence = 0;
  private nextFlushSequence = 0;
  private readonly completed = new Map<number, TResult | null>();
  private readonly onFlush: (result: TResult) => void;

  public constructor({ onFlush }: { onFlush: (result: TResult) => void }) {
    this.onFlush = onFlush;
  }

  /**
   * 领一个序号并发跑 `run`，完成后按序提交。`run` 或提交过程抛错都走 `onError`，
   * 该序号以失败落位（不提交副作用、但不阻塞后续事件）。
   */
  public submit({
    run,
    onError,
  }: {
    run: () => Promise<TResult>;
    onError: (error: unknown) => void;
  }): void {
    const sequence = this.nextSequence;
    this.nextSequence += 1;

    // 刻意用 .then().catch() 链而非 then(onOk, onErr)：提交阶段（onFlush 内的副作用）
    // 抛错也要被同一个 catch 接住，与拆分前的行为一致。
    void run()
      .then(result => {
        this.settle(sequence, result);
      })
      .catch((error: unknown) => {
        onError(error);
        this.settle(sequence, null);
      });
  }

  private settle(sequence: number, result: TResult | null): void {
    this.completed.set(sequence, result);
    this.flush();
  }

  private flush(): void {
    while (this.completed.has(this.nextFlushSequence)) {
      const result = this.completed.get(this.nextFlushSequence) ?? null;
      this.completed.delete(this.nextFlushSequence);
      this.nextFlushSequence += 1;

      if (!result) {
        continue;
      }

      this.onFlush(result);
    }
  }
}
