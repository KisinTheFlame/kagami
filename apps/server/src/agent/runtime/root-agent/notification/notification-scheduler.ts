/**
 * NotificationCenter 的定时器端口。
 *
 * 抽出来是为了**确定性测试**：生产用真实 setInterval，测试注入一个能手动「推进
 * 一次扫描」的假实现，不依赖全局假时钟。
 */
export interface NotificationScheduler {
  /** 每隔 intervalMs 调一次 fn（固定周期扫描）。返回停止函数。 */
  scheduleInterval(intervalMs: number, fn: () => void): () => void;
}

/** 生产实现：setInterval，并 unref 掉——后台扫描不应拖住进程退出。 */
export class RealNotificationScheduler implements NotificationScheduler {
  public scheduleInterval(intervalMs: number, fn: () => void): () => void {
    const timer = setInterval(fn, intervalMs);
    // 通知非关键：关停时丢弃一条待发通知可接受，不让它 hold 住事件循环。
    timer.unref();
    return () => clearInterval(timer);
  }
}
