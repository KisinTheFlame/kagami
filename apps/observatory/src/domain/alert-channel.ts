/**
 * 告警投递通道端口。v1 只有 QQ 群一个实现（`NapcatAlertChannel`）。
 *
 * 抽成端口不是为了「以后可能有别的实现」这种空想，而是为了让 `AlertService` 的编排测试
 * 能注入 fake channel——投递是唯一的外部 IO，不隔离就没法在禁真 napcat 的前提下测编排。
 */
export interface AlertChannel {
  /** 投递一条已渲染好的告警文本。失败必须抛，由上层归一成 `delivered: false`。 */
  deliver(message: string): Promise<void>;
}
