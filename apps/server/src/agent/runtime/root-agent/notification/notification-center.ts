import { AppLogger } from "../../../../logger/logger.js";
import type { NotificationDraft } from "./notification-draft.js";
import { type NotificationScheduler, RealNotificationScheduler } from "./notification-scheduler.js";

const logger = new AppLogger({ source: "agent.notification-center" });

type NotificationCenterDeps = {
  /** 攒批时间窗（毫秒）：第一条 push 起窗，窗到了 flush。 */
  windowMs: number;
  /**
   * flush 时把渲染好的多行通知交出去（每源一行）。调用方负责把它塞进事件队列
   * （在手机 OS 模型里：enqueue 一个 `notification` 事件，既投递内容也唤醒 Agent）。
   */
  onFlush: (lines: string[]) => void;
  /** 定时器端口；缺省用真实 setTimeout。测试注入确定性假实现。 */
  scheduler?: NotificationScheduler;
};

/**
 * 被动、同步、源无关的通知中心（手机 OS 模型）。
 *
 * - `push(draft)`：谁都能调、不挑调用者；同 source 折叠（`draft.merge(prev)`）。
 *   同步操作（只 `Map.set`），Node 单线程下与 flush 无竞争。
 * - setTimeout-on-first-push：pending 从空变非空时起一个窗口，窗到了 flush。
 * - `flush`：渲染所有 draft 成行，交给 `onFlush`；**防御性**——单个 draft 的
 *   `render` 抛错只跳过它、不炸整个 flush。
 * - `clearForSource`：清掉某源的待发（焦点进入该源时用）。
 *
 * 设计依据：手机 OS 模型设计文档（NotificationCenter）。
 */
export class NotificationCenter {
  private readonly pending = new Map<string, NotificationDraft>();
  private readonly windowMs: number;
  private readonly onFlush: (lines: string[]) => void;
  private readonly scheduler: NotificationScheduler;
  private flushScheduled = false;

  public constructor({ windowMs, onFlush, scheduler }: NotificationCenterDeps) {
    this.windowMs = windowMs;
    this.onFlush = onFlush;
    this.scheduler = scheduler ?? new RealNotificationScheduler();
  }

  public push(draft: NotificationDraft): void {
    const prev = this.pending.get(draft.sourceId);
    // this = 最新、prev = 历史：见 NotificationDraft 折叠约定。
    this.pending.set(draft.sourceId, prev ? draft.merge(prev) : draft);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      this.scheduler.schedule(this.windowMs, () => this.flush());
    }
  }

  public clearForSource(sourceId: string): void {
    this.pending.delete(sourceId);
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.pending.size === 0) {
      return;
    }
    const drafts = [...this.pending.values()];
    this.pending.clear();

    const lines: string[] = [];
    for (const draft of drafts) {
      try {
        lines.push(draft.render());
      } catch (error) {
        // 防御性：单个 draft 渲染抛错只跳过它，不影响其余源、不炸 flush。
        logger.warn("Notification draft render failed; skipping", {
          sourceId: draft.sourceId,
          errorName: error instanceof Error ? error.name : "Error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (lines.length > 0) {
      this.onFlush(lines);
    }
  }
}
