/**
 * 摸鱼判定：内心独白注入（issue #265）的确定性门控，零 LLM。
 *
 * 全部条件满足才触发：
 * 1. 最近 windowMs 内 wait 调用 ≥ minWaitCount（wait 密集 = 她反复用行为表态「没什么可干的」）；
 * 2. 该窗口内零投入型工具调用（投入型 = 下方显式枚举；QQ 的 open_conversation /
 *    send_message 不算——刷群接话正是摸鱼本身）；
 * 3. 当日（北京时间自然日）注入尝试 < dailyAttemptLimit，且距上次尝试 ≥ attemptCooldownMs
 *    （尝试含「operation 输出空」的空转轮，防连环空转）；
 * 4. 当前北京时间在 [activeStartHour, activeEndHour) 时段窗内。
 *
 * 常量以 14 天生产 ledger 回放校准（脚本 apps/agent/scripts/replay-inner-voice.mjs，
 * 数据见 apps/agent/docs/inner-voice-idle-replay.md），历史日均触发 1.65 次，落在 1~2 次目标带。
 */

const BEIJING_TIME_ZONE = "Asia/Shanghai";

export type InnerVoiceIdlePolicy = {
  /** 滑动窗口长度（毫秒）。 */
  windowMs: number;
  /** 窗口内 wait 调用触发下限。 */
  minWaitCount: number;
  /** 当日（北京时间自然日）注入尝试上限。 */
  dailyAttemptLimit: number;
  /** 距上次注入尝试的不应期（毫秒）。 */
  attemptCooldownMs: number;
  /** 时段窗起点（北京时间小时，含）。 */
  activeStartHour: number;
  /** 时段窗终点（北京时间小时，不含）。 */
  activeEndHour: number;
};

export const INNER_VOICE_IDLE_POLICY: InnerVoiceIdlePolicy = {
  windowMs: 60 * 60 * 1000,
  minWaitCount: 6,
  dailyAttemptLimit: 2,
  attemptCooldownMs: 4 * 60 * 60 * 1000,
  activeStartHour: 10,
  activeEndHour: 23,
};

/** 顶层投入型工具（直接以工具名出现在 toolCalls 里）。 */
export const ENGAGED_TOP_LEVEL_TOOL_NAMES: ReadonlySet<string> = new Set(["search_web"]);

/**
 * 投入型 invoke 子工具的显式枚举：browser / terminal / hn / ithome / amap 的全部子工具，
 * 外加 add_todo 与 QQ 的 send_resource。QQ 的 open_conversation / send_message /
 * view_forward 等聊天动作刻意不在列。
 *
 * ⚠️ 维护注意：这份清单与真正的工具注册表脱耦、靠人肉同步。新增投入型子工具、或某 App
 * 改子工具名时，必须回填这里，否则摸鱼判定会把它当中性调用——小镜刚认真干完活反被判成
 * 摸鱼、误触发内心独白。更本质的做法是给 Tool 抽象加「是否投入型」的声明维度（现
 * ToolKind 只有 business/control），让工具自报、classifyRootToolCall 查注册表而非查字面量
 * 集合；那属需下沉到 agent-runtime 的抽象补齐，见 issue #288（技术债，与本功能解耦）。
 */
export const ENGAGED_INVOKE_SUBTOOL_NAMES: ReadonlySet<string> = new Set([
  // browser
  "browser_navigate",
  "browser_observe",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_wait_for",
  "browser_screenshot",
  "browser_eval",
  // terminal
  "bash",
  "read_bash_output",
  // hn
  "glance_hn",
  "search_hn",
  "open_hn_thread",
  "open_hn_user",
  // ithome
  "open_ithome_article",
  // amap
  "geocode",
  "regeocode",
  "search_poi",
  "search_around",
  "plan_route",
  "plan_transit",
  "weather",
  "static_map",
  // todo
  "add_todo",
  // qq
  "send_resource",
]);

export type RootToolCallKind = "wait" | "engaged" | "neutral";

/**
 * 把主 Agent 的一次工具调用分类为 wait / 投入型 / 中性。invoke 调用按 `tool` 参数里的
 * 子工具名判定（与 ledger 里 assistant 消息的 toolCalls[].arguments.tool 同构）。
 */
export function classifyRootToolCall(input: {
  name: string;
  argumentsValue: Record<string, unknown>;
}): RootToolCallKind {
  if (input.name === "wait") {
    return "wait";
  }

  if (ENGAGED_TOP_LEVEL_TOOL_NAMES.has(input.name)) {
    return "engaged";
  }

  if (input.name === "invoke") {
    const subtool = input.argumentsValue.tool;
    if (typeof subtool === "string" && ENGAGED_INVOKE_SUBTOOL_NAMES.has(subtool)) {
      return "engaged";
    }
  }

  return "neutral";
}

/** 摸鱼判定的全部输入信号：三组时间戳，由环形缓冲 / ledger 回扫两条路径喂进来。 */
export type InnerVoiceIdleSignals = {
  /** wait 调用时刻。 */
  waitAt: readonly Date[];
  /** 投入型工具调用时刻。 */
  engagedAt: readonly Date[];
  /** 注入尝试时刻（含空输出的空转轮）。 */
  attemptAt: readonly Date[];
};

/** 北京时间的自然日 key（如 "2026-07-02"）与小时数。 */
export function getBeijingClock(date: Date): { dayKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return {
    dayKey: `${values.year}-${values.month}-${values.day}`,
    // Intl 的 hour12:false 在部分环境把 0 点格式化成 "24"，归一到 0。
    hour: Number.parseInt(values.hour, 10) % 24,
  };
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

  const { dayKey, hour } = getBeijingClock(now);
  if (hour < policy.activeStartHour || hour >= policy.activeEndHour) {
    return false;
  }

  const waitCount = signals.waitAt.filter(at => isWithin(at, windowStartMs, nowMs)).length;
  if (waitCount < policy.minWaitCount) {
    return false;
  }

  const hasEngaged = signals.engagedAt.some(at => isWithin(at, windowStartMs, nowMs));
  if (hasEngaged) {
    return false;
  }

  const todayAttemptCount = signals.attemptAt.filter(
    at => getBeijingClock(at).dayKey === dayKey,
  ).length;
  if (todayAttemptCount >= policy.dailyAttemptLimit) {
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
