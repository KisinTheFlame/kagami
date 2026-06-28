/**
 * NotificationCenter 的定时器端口。
 *
 * 抽出来是为了**确定性测试**：生产用真实 setTimeout，测试注入一个能手动「推进
 * 一次窗口结束」的假实现，不依赖全局假时钟。
 */
export interface NotificationScheduler {
  /** 安排 fn 在 delayMs 后执行一次。返回取消函数。 */
  schedule(delayMs: number, fn: () => void): () => void;
}

/** 生产实现：setTimeout，并 unref 掉——后台节流窗口不应拖住进程退出。 */
export class RealNotificationScheduler implements NotificationScheduler {
  public schedule(delayMs: number, fn: () => void): () => void {
    const timer = setTimeout(fn, delayMs);
    // 通知非关键：关停时丢弃一条待发通知可接受，不让它 hold 住事件循环。
    timer.unref();
    return () => clearTimeout(timer);
  }
}
