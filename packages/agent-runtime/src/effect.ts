import type { LlmMessage } from "@kagami/llm";

/**
 * Effect 是描述 "Agent 状态变更动作" 的结构化数据。
 *
 * Effect 是开放接口——agent-runtime 只规定它有 `type` 字段，具体 Effect 联合
 * 由各 Agent 实现方自己定义（比如 root-agent 用 `switch_app` / `append_message`
 * 这种字面量联合）。
 *
 * 工具 / App 钩子 / 事件 handler / LoopAgent extension 都产 Effect[]。
 * Agent 端用自己的 `EffectInterpreter` 解释执行。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
 */
export interface Effect {
  readonly type: string;
}

/**
 * EffectInterpreter 是 Effect → 系统变更 的唯一翻译者。
 *
 * `ReActKernel` 跑完一个工具后立刻把它的 `effects` 交给 Interpreter；Interpreter
 * 自己处理那些 "立即副作用"（切状态、replace、阻塞 await），并把两类输出返给
 * kernel：
 *
 * - `appendedMessages`：要追加到本轮 commit 的消息列表，走 kernel 的原子提交。
 * - `control`（可选）：控制流信号。默认 `never`——RootAgent 这种没有 "循环退出"
 *   语义的 Agent 用不到。TaskAgent 把 `TControl` specialize 成
 *   `{ kind: "stop"; content: string }`，让外层 `BaseTaskAgent.invoke` 看到
 *   `control.kind === "stop"` 就退出循环。
 *
 * **Effect 自描述原则**：每种 Effect 自带完整语义负载（比如 `terminate` 自带
 * `content: string`）。Interpreter 不依赖外部 "tool 上下文" 参数——这样 host
 * 直接调和 kernel 间接调走完全相同的 `apply` 方法。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
 */
export interface EffectInterpreter<TControl = never> {
  apply(effects: readonly Effect[]): Promise<EffectInterpreterResult<TControl>>;
}

export type EffectInterpreterResult<TControl = never> = {
  readonly appendedMessages: readonly LlmMessage[];
  readonly control?: TControl;
};

/**
 * 不处理任何 Effect 的 Interpreter。给那些"工具集本来就不产 Effect"的 kernel
 * 显式使用——表明 "我知道这条路径不处理 effects"，避免 interpreter optional
 * 时静默丢弃 effects 引入难调试 bug。
 *
 * 实际收到 effects 时会抛错（声明的契约是"无 effect"，传入即违约）。
 */
export class NoopEffectInterpreter implements EffectInterpreter<never> {
  public async apply(effects: readonly Effect[]): Promise<EffectInterpreterResult<never>> {
    if (effects.length > 0) {
      const types = effects.map(effect => effect.type).join(", ");
      throw new Error(
        `NoopEffectInterpreter received effects but is declared to handle none: [${types}]`,
      );
    }
    return { appendedMessages: [] };
  }
}

// ============================================================================
// Effect Handler 模型
//
// Interpreter 的标准实现方式：把"如何处理某一类 Effect"拆成一个个 EffectHandler，
// 用 HandlerEffectInterpreter 把它们组合起来。复用粒度是 handler——不同 Agent
// 装不同的 handler 子集：
//   - RootAgent：ReplaceLeadingMessagesHandler（公共）+ 自己的 switch_app /
//     switch_state / wait_for_event / append_message handler
//   - StoryAgent compact：只装 ReplaceLeadingMessagesHandler（公共）
// 公共 Effect + 公共 handler 收在 agent-runtime；Agent 专属 Effect + 专属 handler
// 留在各 Agent 自己的包里。
//
// 设计依据：[docs/effect-model.md](docs/effect-model.md)。
// ============================================================================

export type EffectHandlerResult<TControl = never> = {
  readonly appendedMessages?: readonly LlmMessage[];
  readonly control?: TControl;
};

/**
 * 处理某一类 Effect 的单元。`matches` 是路由判定（通常按 `effect.type` 判），
 * `handle` 在 matches 为 true 后执行实际副作用。
 *
 * handle 入参是基类 `Effect`——具体 handler 内部在 matches 通过后自行 narrow
 * （cast）。这是刻意的：让 HandlerEffectInterpreter 能把异构 handler 收进同一个
 * 数组而不触发 TEffect 逆变冲突。matches 与 handle 的类型一致性由各 handler 自身
 * 这一处保证。
 */
export interface EffectHandler<TControl = never> {
  matches(effect: Effect): boolean;
  handle(effect: Effect): Promise<EffectHandlerResult<TControl>>;
}

/**
 * 由一组 EffectHandler 组成的标准 Interpreter。按数组顺序为每个 Effect 找第一个
 * matches 的 handler 执行。找不到 handler 直接抛错——不静默丢弃，避免业务上"以为
 * 生效了实际没生效"。
 *
 * 累积所有 handler 产出的 appendedMessages；control 取最后一个产出 control 的
 * handler 结果（与 ReActKernel 内 `capturedControl` 覆盖语义一致）。
 */
export class HandlerEffectInterpreter<TControl = never> implements EffectInterpreter<TControl> {
  private readonly handlers: readonly EffectHandler<TControl>[];

  public constructor(handlers: readonly EffectHandler<TControl>[]) {
    this.handlers = handlers;
  }

  public async apply(effects: readonly Effect[]): Promise<EffectInterpreterResult<TControl>> {
    const appendedMessages: LlmMessage[] = [];
    let control: TControl | undefined;
    for (const effect of effects) {
      const handler = this.handlers.find(candidate => candidate.matches(effect));
      if (!handler) {
        throw new Error(
          `No EffectHandler matched Effect "${effect.type}". ` +
            `Either the effect is routed to the wrong agent, or a handler is missing.`,
        );
      }
      const result = await handler.handle(effect);
      if (result.appendedMessages && result.appendedMessages.length > 0) {
        appendedMessages.push(...result.appendedMessages);
      }
      if (result.control !== undefined) {
        control = result.control;
      }
    }
    return control !== undefined ? { appendedMessages, control } : { appendedMessages };
  }
}

// ============================================================================
// 公共 Effect 与公共 handler
// ============================================================================

export const REPLACE_LEADING_MESSAGES_EFFECT_TYPE = "replace_leading_messages";

/**
 * 把 context 最前面的 `count` 条 message 替换成 `replacement`。
 *
 * 这是**昂贵动作**——破坏 KV 缓存前缀。守门靠约定：只有上下文压缩这类"计划性
 * 重建"组件应产生此 Effect，工具/钩子产它是 bug。
 *
 * 为什么是"前缀替换"而非"整列重建"：compact 的本质就是"把最旧的一段压成摘要、
 * 保留最近一段"——旧的永远在前缀。`count` = 被摘要的前缀长度，`replacement` =
 * `[summaryMessage]`。保留段不用显式携带（它就是 count 之后的部分），所以产 Effect
 * 的一方（如 ContextSummaryOperation）不需要知道"保留哪些"，职责更纯。全量压缩 =
 * count 取全部 message 数。
 */
export interface ReplaceLeadingMessagesEffect extends Effect {
  readonly type: typeof REPLACE_LEADING_MESSAGES_EFFECT_TYPE;
  /** 要替换的前缀 message 条数（按展平后的 message 计）。 */
  readonly count: number;
  /** 替换成的新 message（compact 场景通常是单条 summary）。 */
  readonly replacement: readonly LlmMessage[];
}

/** ReplaceLeadingMessagesHandler 依赖的最小 context 端口。 */
export interface ReplaceLeadingMessagesTarget {
  replaceLeadingMessages(count: number, replacement: LlmMessage[]): Promise<void>;
}

/**
 * 公共 handler：处理 `replace_leading_messages` Effect，直接调
 * target.replaceLeadingMessages。
 *
 * replace 不走 kernel 的原子追加协议（它是"计划性重建"，不是追加），所以直接改
 * context、不返 appendedMessages。RootAgent 和 StoryAgent compact 都复用它。
 */
export class ReplaceLeadingMessagesHandler implements EffectHandler<never> {
  private readonly target: ReplaceLeadingMessagesTarget;

  public constructor(target: ReplaceLeadingMessagesTarget) {
    this.target = target;
  }

  public matches(effect: Effect): boolean {
    return effect.type === REPLACE_LEADING_MESSAGES_EFFECT_TYPE;
  }

  public async handle(effect: Effect): Promise<EffectHandlerResult<never>> {
    const replace = effect as ReplaceLeadingMessagesEffect;
    await this.target.replaceLeadingMessages(replace.count, [...replace.replacement]);
    return {};
  }
}
