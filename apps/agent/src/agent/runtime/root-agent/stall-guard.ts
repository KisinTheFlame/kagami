import type { RaiseAlertRequest } from "@kagami/observatory-api/alert";

/**
 * 连续多少轮「没动手」才判定为卡住。代码常量：不随环境变、运维不会在线上调它。
 *
 * 两个计数器共用同一个阈值。因为 empty ⊂ noTool，纯空的场景下两者同一轮到顶——此时取更具体的
 * `empty`（见 {@link StallGuard.observe}）。
 */
const STALL_THRESHOLD = 4;

/** 一轮 ReAct 的形状。 */
export type RoundShape =
  /** 有 tool call（含 `wait`、含只调 control 工具）——她动手了。 */
  | "acted"
  /** 零 tool call 但有文本——她说了话没动手。 */
  | "text_only"
  /** 零 tool call 且文本为空（含纯空白）——她什么都没输出。 */
  | "empty";

export type StallReason = "empty" | "no_tool";

export type StallAlertInput = {
  reason: StallReason;
  emptyStreak: number;
  noToolStreak: number;
};

export type StallDecision = {
  /** 是否该挂起到下一个事件。 */
  suspend: boolean;
  /** 非 null = 该发一条告警（与 suspend 同时成立）。 */
  alert: StallAlertInput | null;
};

/**
 * 判定本轮形状。
 *
 * **`toolCalls` 必须是原始的、`toPersistableAssistantMessage` 过滤前的数组**：只调了 control
 * 工具（如 `switch`）的轮次虽然不留痕进上下文，但那是**动作**不是 stall，误判会让「她正在切 App」
 * 被当成卡住。
 *
 * 「文本为空」按 `trim()` 判，与[持久化门控](./root-agent-runtime.ts)逐字节一致（那里也是
 * `content.trim().length > 0`）。两处必须同判，否则会出现「上下文里丢弃了、却被计为 text_only」
 * 的错配。
 */
export function classifyRoundShape(message: {
  content: string;
  toolCalls: readonly unknown[];
}): RoundShape {
  if (message.toolCalls.length > 0) {
    return "acted";
  }

  return message.content.trim().length > 0 ? "text_only" : "empty";
}

/**
 * ReAct 空转分级检测的纯状态机（issue #602）。
 *
 * 背景：此前零工具轮**一律立刻挂起**（#268 为 2026-05-30 用量暴涨事故加的闸）。粒度太粗——她吐
 * 一个空 content 就睡 10 分钟，外面看就是「卡死」，而且没有任何人被通知。现在改成允许连续跑，
 * 到阈值才挂起并告警。
 *
 * 两个计数器一层包一层（`empty ⊂ noTool`）：
 *
 * | 形状 | emptyStreak | noToolStreak |
 * |---|---|---|
 * | `acted` | 归 0 | 归 0 |
 * | `text_only` | **归 0** | +1 |
 * | `empty` | +1 | +1 |
 *
 * 所以 `text, empty, empty, empty` → `noToolStreak=4` / `emptyStreak=3`，报 `no_tool`；
 * `empty×4` → 两者都到 4，报更具体的 `empty`。任何时刻只发一条告警，载荷里带两个计数让人能
 * 分辨混合形态。
 *
 * 触发后两个计数器都归零——否则醒来第一个无动作轮就会立刻再告警一次。
 *
 * 纯内存、不进快照：重启即清零，重启本身就是新的活性窗口。
 */
export class StallGuard {
  private readonly threshold: number;
  private emptyStreak = 0;
  private noToolStreak = 0;

  public constructor({ threshold }: { threshold?: number } = {}) {
    this.threshold = threshold ?? STALL_THRESHOLD;
  }

  public observe(shape: RoundShape): StallDecision {
    if (shape === "acted") {
      this.emptyStreak = 0;
      this.noToolStreak = 0;
      return { suspend: false, alert: null };
    }

    this.noToolStreak += 1;
    if (shape === "empty") {
      this.emptyStreak += 1;
    } else {
      this.emptyStreak = 0;
    }

    // empty ⊂ noTool 且共用阈值，纯空场景下两者同轮到顶——先判 empty，取更具体的那个。
    const reason: StallReason | null =
      this.emptyStreak >= this.threshold
        ? "empty"
        : this.noToolStreak >= this.threshold
          ? "no_tool"
          : null;
    if (reason === null) {
      return { suspend: false, alert: null };
    }

    const alert: StallAlertInput = {
      reason,
      emptyStreak: this.emptyStreak,
      noToolStreak: this.noToolStreak,
    };
    this.reset();
    return { suspend: true, alert };
  }

  /** 计划性重建（`resetContext`）后重开活性窗口。 */
  public reset(): void {
    this.emptyStreak = 0;
    this.noToolStreak = 0;
  }
}

/**
 * stall → 通用告警载荷的映射。纯函数、与状态机同处一文件，好让单测直接逐字段断言，而不是把
 * 映射逻辑埋进 `runOnce` 里测不到。
 */
export function createStallAlert(
  input: StallAlertInput & { runtimeKey: string },
): RaiseAlertRequest {
  const isEmpty = input.reason === "empty";
  return {
    source: "agent",
    event: isEmpty ? "react.empty_stall" : "react.no_tool_stall",
    severity: "error",
    title: isEmpty
      ? `连续 ${input.emptyStreak} 轮 LLM 返回空内容，已挂起等待下一个事件。`
      : `连续 ${input.noToolStreak} 轮没有任何工具调用，已挂起等待下一个事件。`,
    context: {
      emptyStreak: input.emptyStreak,
      noToolStreak: input.noToolStreak,
      runtimeKey: input.runtimeKey,
    },
  };
}
