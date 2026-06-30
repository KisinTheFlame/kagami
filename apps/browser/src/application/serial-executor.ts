/**
 * 动作串行执行器：把所有浏览器动作排成单飞队列。
 *
 * 拆进程前，浏览器动作天然串行——只有 agent 单线程主循环在调。拆成 HTTP 服务后，
 * 多来源（agent、重试、未来的管理台）可能并发打同一个 page，让 BrowserService 的
 * observeEpoch / pageStack / locator 解析竞态。这里用一条 promise 链把动作首尾相接，
 * 保证任一时刻只有一个动作在跑，不依赖「调用方单线程」这个已被打破的假设。
 *
 * 设计依据：issue #173（codex 评审点 6）。
 */
export class SerialExecutor {
  private tail: Promise<unknown> = Promise.resolve();

  /** 把 task 接到队尾，等前面的全部结束（无论成败）后再跑。返回 task 自己的结果/异常。 */
  public run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // 队尾只关心「上一个跑完了」，吞掉成败，避免一个失败的动作毒死整条链。
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
