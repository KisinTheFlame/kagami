import { AppLogger } from "../../../../logger/logger.js";
import type { NotificationDraft } from "./notification-draft.js";
import { type NotificationScheduler, RealNotificationScheduler } from "./notification-scheduler.js";

const logger = new AppLogger({ source: "agent.notification-center" });

type NotificationCenterDeps = {
  /**
   * 前沿短窗（毫秒）：空闲时第一条 push **不再立即发**，而是开这么长的短窗聚合首批突发，
   * 窗结束才 flush。首批通知因此最多延迟 leadingWindowMs。
   */
  leadingWindowMs: number;
  /** 节流窗口（毫秒）：一次 flush 后的这段时间内，新通知攒着不立即发。 */
  windowMs: number;
  /**
   * flush 时把分好段的多行通知交出去（每段一个 `{group}:` 标题 + 各源一行，段间空行）。
   * 调用方负责把它塞进事件队列（手机 OS 模型里：enqueue 一个 `notification` 事件，
   * 既投递内容也唤醒 Agent）。pending 为空时不会调用。
   */
  onFlush: (lines: string[]) => void;
  /** 定时器端口；缺省用真实 setTimeout。测试注入确定性假实现。 */
  scheduler?: NotificationScheduler;
};

/**
 * 被动、同步、源无关的通知中心（手机 OS 模型）。
 *
 * **前沿短窗 + 节流窗口**——既聚合突发、又不让首批通知一来就把 Agent 打断：
 * - **空闲**（没有进行中的窗口）时 `push` 一条 → 开一个 **leadingWindowMs 的前沿短窗**攒着，
 *   **不立即发**；短窗结束才 flush（首批因此最多延迟 leadingWindowMs，用来聚合一小撮突发）。
 * - **窗口中** `push` → 同 source 折叠后攒着，不立即发。
 * - **窗结束**：还有攒着的 → flush 出那一批 + 再开一个 **windowMs 的节流窗**（继续节流后续）；
 *   没攒着的 → 回到空闲，下一条又会重新走前沿短窗。
 *
 * 折叠：`push` 同 source 走 `draft.merge(prev)`；同步操作（只 `Map.set`），Node 单线程下
 * 与 flush 无竞争。flush 按 `draft.group` 分段（`{group}:` 标题 + 每源 `render()` 一行，
 * 段间空行），**防御性**——单个 draft 的 `render` 抛错只跳过它。
 *
 * 设计依据：手机 OS 模型设计文档（NotificationCenter）。
 */
export class NotificationCenter {
  private readonly pending = new Map<string, NotificationDraft>();
  private readonly leadingWindowMs: number;
  private readonly windowMs: number;
  private readonly onFlush: (lines: string[]) => void;
  private readonly scheduler: NotificationScheduler;
  /** 进行中窗口的取消函数；null 表示空闲。 */
  private cancelWindow: (() => void) | null = null;

  public constructor({ leadingWindowMs, windowMs, onFlush, scheduler }: NotificationCenterDeps) {
    this.leadingWindowMs = leadingWindowMs;
    this.windowMs = windowMs;
    this.onFlush = onFlush;
    this.scheduler = scheduler ?? new RealNotificationScheduler();
  }

  public push(draft: NotificationDraft): void {
    const prev = this.pending.get(draft.sourceId);
    // this = 最新、prev = 历史：见 NotificationDraft 折叠约定。
    this.pending.set(draft.sourceId, prev ? draft.merge(prev) : draft);

    if (this.cancelWindow === null) {
      // 空闲：开一个前沿短窗聚合首批突发，窗结束才 flush（不再前沿立即发）。
      this.openWindow(this.leadingWindowMs);
    }
    // 窗口中：攒着，窗结束时一并 flush。
  }

  public clearForSource(sourceId: string): void {
    this.pending.delete(sourceId);
  }

  /** 关停时停掉进行中的窗口。 */
  public stop(): void {
    this.cancelWindow?.();
    this.cancelWindow = null;
  }

  private openWindow(delayMs: number): void {
    this.cancelWindow = this.scheduler.schedule(delayMs, () => this.onWindowEnd());
  }

  private onWindowEnd(): void {
    if (this.pending.size > 0) {
      // 窗内攒了东西：聚合发出，再开一个节流窗继续节流后续。
      this.flush();
      this.openWindow(this.windowMs);
    } else {
      // 静默一整窗：回到空闲，下一条又会重新走前沿短窗。
      this.cancelWindow = null;
    }
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
