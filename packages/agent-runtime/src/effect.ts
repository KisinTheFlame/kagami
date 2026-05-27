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
export interface EffectInterpreter<TMessage, TControl = never> {
  apply(effects: readonly Effect[]): Promise<EffectInterpreterResult<TMessage, TControl>>;
}

export type EffectInterpreterResult<TMessage, TControl = never> = {
  readonly appendedMessages: readonly TMessage[];
  readonly control?: TControl;
};

/**
 * 不处理任何 Effect 的 Interpreter。给那些"工具集本来就不产 Effect"的 kernel
 * 显式使用——表明 "我知道这条路径不处理 effects"，避免 interpreter optional
 * 时静默丢弃 effects 引入难调试 bug。
 *
 * 实际收到 effects 时会抛错（声明的契约是"无 effect"，传入即违约）。
 */
export class NoopEffectInterpreter<TMessage> implements EffectInterpreter<TMessage, never> {
  public async apply(
    effects: readonly Effect[],
  ): Promise<EffectInterpreterResult<TMessage, never>> {
    if (effects.length > 0) {
      const types = effects.map(effect => effect.type).join(", ");
      throw new Error(
        `NoopEffectInterpreter received effects but is declared to handle none: [${types}]`,
      );
    }
    return { appendedMessages: [] };
  }
}
