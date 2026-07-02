import {
  evaluateIdleTrigger,
  INNER_VOICE_IDLE_POLICY,
  type InnerVoiceIdlePolicy,
  type InnerVoiceIdleSignals,
  type RootToolCallKind,
} from "./idle-detector.js";

/**
 * 尝试时间戳的保留窗口：要覆盖「当日（北京时间自然日）计数」与不应期，48h 富余充足。
 * wait / 投入型时间戳只需覆盖滑动窗口本身。
 */
const ATTEMPT_RETENTION_MS = 48 * 60 * 60 * 1000;

/**
 * 摸鱼判定的进程内状态：三条按时间递增的时间戳环形缓冲（wait / 投入型 / 注入尝试）。
 * 判定本体是纯函数 evaluateIdleTrigger，本类只负责收纳与修剪；时钟由调用方注入。
 * 重启后由 ledger 回扫（collectInnerVoiceIdleSignals）经 restore 恢复。
 */
export class InnerVoiceIdleTracker {
  private readonly policy: InnerVoiceIdlePolicy;
  private waitAt: Date[] = [];
  private engagedAt: Date[] = [];
  private attemptAt: Date[] = [];

  public constructor({ policy }: { policy?: InnerVoiceIdlePolicy } = {}) {
    this.policy = policy ?? INNER_VOICE_IDLE_POLICY;
  }

  /** 记录一轮里出现的工具调用分类（中性调用被忽略）。 */
  public recordToolCall(kind: RootToolCallKind, at: Date): void {
    if (kind === "wait") {
      this.waitAt.push(at);
    } else if (kind === "engaged") {
      this.engagedAt.push(at);
    }
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
    this.engagedAt = sortAscending(signals.engagedAt);
    this.attemptAt = sortAscending(signals.attemptAt);
  }

  public reset(): void {
    this.waitAt = [];
    this.engagedAt = [];
    this.attemptAt = [];
  }

  private snapshot(): InnerVoiceIdleSignals {
    return {
      waitAt: this.waitAt,
      engagedAt: this.engagedAt,
      attemptAt: this.attemptAt,
    };
  }

  private prune(now: Date): void {
    const windowStartMs = now.getTime() - this.policy.windowMs;
    const attemptStartMs = now.getTime() - ATTEMPT_RETENTION_MS;
    this.waitAt = this.waitAt.filter(at => at.getTime() > windowStartMs);
    this.engagedAt = this.engagedAt.filter(at => at.getTime() > windowStartMs);
    this.attemptAt = this.attemptAt.filter(at => at.getTime() > attemptStartMs);
  }
}

function sortAscending(values: readonly Date[]): Date[] {
  return [...values].sort((left, right) => left.getTime() - right.getTime());
}
