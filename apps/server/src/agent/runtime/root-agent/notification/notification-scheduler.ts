/**
 * NotificationCenter 的定时器端口。
 *
 * 抽出来是为了**确定性测试**：生产用真实 setTimeout，测试注入一个能手动「推进
 * 窗口」的假实现，不依赖全局假时钟。设计依据：手机 OS 模型设计文档（PR1 / center
 * 可测性，eng-review Finding 1）。
 */
export interface NotificationScheduler {
  /** 安排 fn 在 delayMs 后执行一次。center 每个窗口至多调一次。 */
  schedule(delayMs: number, fn: () => void): void;
}

/** 生产实现：setTimeout，并 unref 掉——后台 flush 定时器不应拖住进程退出。 */
export class RealNotificationScheduler implements NotificationScheduler {
  public schedule(delayMs: number, fn: () => void): void {
    const timer = setTimeout(fn, delayMs);
    // 通知非关键：关停时丢弃一条待发通知可接受，不让它 hold 住事件循环。
    timer.unref();
  }
}
