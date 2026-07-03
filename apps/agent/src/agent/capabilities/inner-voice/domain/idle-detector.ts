/**
 * 摸鱼判定：内心独白注入（issue #265）的确定性门控，零 LLM。
 *
 * 全部条件满足才触发：
 * 1. 最近 windowMs 内 wait 调用 ≥ minWaitCount（wait 密集 = 她反复用行为表态「没什么可干的」）；
 * 2. 距上次注入尝试 ≥ attemptCooldownMs（尝试含「operation 输出空」的空转轮，防连环空转）；
 * 3. 当前北京时间不在静默窗 [quietStartHour, quietEndHour)（默认凌晨 1 点到上午 9 点不冒念头）。
 *
 * 注：不设当日上限、不设投入型豁免——按 2026-07-04 用户要求放开，判定退化为「wait 够密 +
 * 隔够久 + 不在深夜」三条。触发频率由此显著提高（摸鱼时最快每 attemptCooldownMs 一次），
 * 埋了 metric（见 inner-voice.extension.ts）监测实际频率。
 */

const BEIJING_TIME_ZONE = "Asia/Shanghai";

export type InnerVoiceIdlePolicy = {
  /** 滑动窗口长度（毫秒）。 */
  windowMs: number;
  /** 窗口内 wait 调用触发下限。 */
  minWaitCount: number;
  /** 距上次注入尝试的不应期（毫秒）。 */
  attemptCooldownMs: number;
  /** 静默窗起点（北京时间小时，含）——此区间内不触发。 */
  quietStartHour: number;
  /** 静默窗终点（北京时间小时，不含）。 */
  quietEndHour: number;
};

export const INNER_VOICE_IDLE_POLICY: InnerVoiceIdlePolicy = {
  windowMs: 30 * 60 * 1000,
  minWaitCount: 3,
  attemptCooldownMs: 30 * 60 * 1000,
  quietStartHour: 1,
  quietEndHour: 9,
};

/** 摸鱼判定的输入信号：两组时间戳，由环形缓冲 / ledger 回扫两条路径喂进来。 */
export type InnerVoiceIdleSignals = {
  /** wait 调用时刻。 */
  waitAt: readonly Date[];
  /** 注入尝试时刻（含空输出的空转轮）。 */
  attemptAt: readonly Date[];
};

/** 一次工具调用是否是 wait（摸鱼判定只关心 wait 密度，不再区分「投入型」）。 */
export function isWaitToolCall(name: string): boolean {
  return name === "wait";
}

/** 北京时间的小时数（0–23）。 */
export function getBeijingHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find(part => part.type === "hour")?.value ?? "0";
  // Intl 的 hour12:false 在部分环境把 0 点格式化成 "24"，归一到 0。
  return Number.parseInt(hourPart, 10) % 24;
}

/** 纯函数摸鱼判定：给定当前时刻与信号，回答「此刻是否触发一次内心独白注入尝试」。 */
export function evaluateIdleTrigger(input: {
  now: Date;
  signals: InnerVoiceIdleSignals;
  policy?: InnerVoiceIdlePolicy;
}): boolean {
  const { now, signals } = input;
  const policy = input.policy ?? INNER_VOICE_IDLE_POLICY;
  const nowMs = now.getTime();
  const windowStartMs = nowMs - policy.windowMs;

  const hour = getBeijingHour(now);
  if (hour >= policy.quietStartHour && hour < policy.quietEndHour) {
    return false;
  }

  const waitCount = signals.waitAt.filter(at => isWithin(at, windowStartMs, nowMs)).length;
  if (waitCount < policy.minWaitCount) {
    return false;
  }

  const lastAttemptMs = signals.attemptAt.reduce(
    (latest, at) => Math.max(latest, at.getTime()),
    Number.NEGATIVE_INFINITY,
  );
  if (nowMs - lastAttemptMs < policy.attemptCooldownMs) {
    return false;
  }

  return true;
}

function isWithin(at: Date, startMs: number, endMs: number): boolean {
  const atMs = at.getTime();
  return atMs > startMs && atMs <= endMs;
}
