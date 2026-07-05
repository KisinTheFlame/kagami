/**
 * 服务端 SSE 通用工具：任何用 `reply.hijack()` + 裸 ServerResponse 承载 `text/event-stream` 的
 * Fastify 端点共用。首个消费者是 napcat 入站事件流（issue #425），scheduler tick 流复用同一背压保护
 * （issue #428 拆分后遗漏）。
 */

/** 背压写所需的 res 最小面（便于单测注入假 res，无需真 ServerResponse）。 */
export type BackpressureWritable = {
  write(chunk: string): boolean;
  once(event: "close", listener: () => void): void;
  destroy(): void;
};

/**
 * 背压感知的写入（issue #425）：`res.write` 返回 false = 内核发送缓冲已满、消费方跟不上。慢/半死
 * 消费方若一直不 drain，无脑续写会让服务端进程内存无界增长。
 *
 * 对策：一旦背压就**停止后续写**（硬约束内存——不再往缓冲堆新帧），挂宽限期后 destroy 连接。消费方
 * 侧看门狗会重连（napcat 带 Last-Event-ID 从 outbox 回放缺口；scheduler 重连重新注册 + flush pending，
 * tick 是派生事实不做回放）。destroy 后 `dead` 短路一切写，杜绝写已毁的 res（write-after-destroy）。
 * 客户端先断连（res close）则清 timer，不留悬挂定时器 / 虚假日志。onTimeout 在 destroy 前回调（记日志
 * 用）。正常快消费方永不触发。
 */
export function createBackpressureAwareWrite(
  res: BackpressureWritable,
  graceMs: number,
  onTimeout?: () => void,
): (chunk: string) => void {
  let dead = false;
  return (chunk: string): void => {
    if (dead) {
      return;
    }
    if (res.write(chunk)) {
      return;
    }
    // 触发背压：这一帧 Node 已缓冲（不丢），但立刻停写后续帧。宽限期给已缓冲数据一点 flush 时间，
    // 到期 destroy —— 消费方重连。若客户端在宽限期内先断连，清掉 timer 即可。
    dead = true;
    const timer = setTimeout(() => {
      onTimeout?.();
      res.destroy();
    }, graceMs);
    timer.unref?.();
    res.once("close", () => clearTimeout(timer));
  };
}
