import { AppLogger } from "../../../../logger/logger.js";
import type { NotificationDraft } from "./notification-draft.js";
import { type NotificationScheduler, RealNotificationScheduler } from "./notification-scheduler.js";

const logger = new AppLogger({ source: "agent.notification-center" });

type NotificationCenterDeps = {
  /** 固定扫描周期（毫秒）：每隔 windowMs 把当前攒下的通知 flush 一次。 */
  windowMs: number;
  /**
   * flush 时把分好段的多行通知交出去（每段一个 `{group}:` 标题 + 各源一行，段间空行）。
   * 调用方负责把它塞进事件队列（手机 OS 模型里：enqueue 一个 `notification` 事件，
   * 既投递内容也唤醒 Agent）。pending 为空的那次扫描不会调用。
   */
  onFlush: (lines: string[]) => void;
  /** 定时器端口；缺省用真实 setInterval。测试注入确定性假实现。 */
  scheduler?: NotificationScheduler;
};

/**
 * 被动、同步、源无关的通知中心（手机 OS 模型）。
 *
 * - `push(draft)`：谁都能调、不挑调用者；同 source 折叠（`draft.merge(prev)`）。
 *   同步操作（只 `Map.set`），Node 单线程下与 flush 无竞争。
 * - **固定周期扫描**：构造时起一个每 windowMs 的 setInterval，到点把当前攒下的
 *   通知 flush；空闲时扫描是 no-op（不 enqueue）。
 * - `flush`：按 `draft.group` 分段（`{group}:` 标题 + 每源 `render()` 一行，段间
 *   空行），交给 `onFlush`；**防御性**——单个 draft 的 `render` 抛错只跳过它。
 * - `clearForSource`：清掉某源的待发（焦点进入该源时用）。
 *
 * 设计依据：手机 OS 模型设计文档（NotificationCenter）。
 */
export class NotificationCenter {
  private readonly pending = new Map<string, NotificationDraft>();
  private readonly onFlush: (lines: string[]) => void;
  private readonly stopInterval: () => void;

  public constructor({ windowMs, onFlush, scheduler }: NotificationCenterDeps) {
    this.onFlush = onFlush;
    const activeScheduler = scheduler ?? new RealNotificationScheduler();
    this.stopInterval = activeScheduler.scheduleInterval(windowMs, () => this.flush());
  }

  public push(draft: NotificationDraft): void {
    const prev = this.pending.get(draft.sourceId);
    // this = 最新、prev = 历史：见 NotificationDraft 折叠约定。
    this.pending.set(draft.sourceId, prev ? draft.merge(prev) : draft);
  }

  public clearForSource(sourceId: string): void {
    this.pending.delete(sourceId);
  }

  /** 停止后台扫描（关停时可调；一般 unref 的 interval 不调也无妨）。 */
  public stop(): void {
    this.stopInterval();
  }

  private flush(): void {
    if (this.pending.size === 0) {
      return;
    }
    const drafts = [...this.pending.values()];
    this.pending.clear();

    // 按 group 分段；段内每源一行。
    const byGroup = new Map<string, string[]>();
    for (const draft of drafts) {
      let line: string;
      try {
        line = draft.render();
      } catch (error) {
        // 防御性：单个 draft 渲染抛错只跳过它，不影响其余源、不炸 flush。
        logger.warn("Notification draft render failed; skipping", {
          sourceId: draft.sourceId,
          errorName: error instanceof Error ? error.name : "Error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const lines = byGroup.get(draft.group);
      if (lines) {
        lines.push(line);
      } else {
        byGroup.set(draft.group, [line]);
      }
    }

    if (byGroup.size === 0) {
      return;
    }

    const out: string[] = [];
    let first = true;
    for (const [group, lines] of byGroup) {
      if (!first) {
        out.push(""); // 段间空行
      }
      first = false;
      out.push(`${group}:`);
      out.push(...lines);
    }
    this.onFlush(out);
  }
}
