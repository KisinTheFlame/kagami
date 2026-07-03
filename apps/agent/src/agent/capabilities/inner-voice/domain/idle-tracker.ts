import {
  evaluateIdleTrigger,
  INNER_VOICE_IDLE_POLICY,
  type InnerVoiceIdlePolicy,
  type InnerVoiceIdleSignals,
} from "./idle-detector.js";

/**
 * 尝试时间戳的保留窗口：覆盖不应期即可，2h 富余充足（不应期默认 30min）。
 * wait 时间戳只需覆盖滑动窗口本身。
 */
const ATTEMPT_RETENTION_MS = 2 * 60 * 60 * 1000;

/**
 * 摸鱼判定的进程内状态：两条按时间递增的时间戳环形缓冲（wait / 注入尝试）。
 * 判定本体是纯函数 evaluateIdleTrigger，本类只负责收纳与修剪；时钟由调用方注入。
 * 重启后由 ledger 回扫（collectInnerVoiceIdleSignals）经 restore 恢复。
 */
export class InnerVoiceIdleTracker {
  private readonly policy: InnerVoiceIdlePolicy;
  private waitAt: Date[] = [];
  private attemptAt: Date[] = [];

  public constructor({ policy }: { policy?: InnerVoiceIdlePolicy } = {}) {
    this.policy = policy ?? INNER_VOICE_IDLE_POLICY;
  }

  /** 记录一次 wait 调用。 */
  public recordWait(at: Date): void {
    this.waitAt.push(at);
  }

  /** 记录一次注入尝试（无论 operation 是否产出念头都消耗配额，防连环空转）。 */
  public recordAttempt(at: Date): void {
    this.attemptAt.push(at);
  }

  /** 修剪过期时间戳后做一次纯函数判定。 */
  public shouldTrigger(now: Date): boolean {
    this.prune(now);
    return evaluateIdleTrigger({ now, signals: this.snapshot(), policy: this.policy });
  }

  /** 重启回扫 ledger 后一次性恢复状态（覆盖既有内容）。 */
  public restore(signals: InnerVoiceIdleSignals): void {
    this.waitAt = sortAscending(signals.waitAt);
    this.attemptAt = sortAscending(signals.attemptAt);
  }

  public reset(): void {
    this.waitAt = [];
    this.attemptAt = [];
  }

  private snapshot(): InnerVoiceIdleSignals {
    return {
      waitAt: this.waitAt,
      attemptAt: this.attemptAt,
    };
  }

  private prune(now: Date): void {
    const windowStartMs = now.getTime() - this.policy.windowMs;
    const attemptStartMs = now.getTime() - ATTEMPT_RETENTION_MS;
    this.waitAt = this.waitAt.filter(at => at.getTime() > windowStartMs);
    this.attemptAt = this.attemptAt.filter(at => at.getTime() > attemptStartMs);
  }
}

function sortAscending(values: readonly Date[]): Date[] {
  return [...values].sort((left, right) => left.getTime() - right.getTime());
}
