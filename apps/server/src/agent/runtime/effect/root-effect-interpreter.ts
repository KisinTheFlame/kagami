import type { EffectInterpreter, EffectInterpreterResult } from "@kagami/agent-runtime";
import type { AgentContext } from "../context/agent-context.js";
import type { Event } from "../event/event.js";
import type { AgentEventQueue } from "../event/event.queue.js";
import type { LlmMessage } from "../../../llm/types.js";
import { createUserMessage } from "../context/context-message-factory.js";
import type { RootAgentSessionController } from "../root-agent/session/root-agent-session.js";
import type { RootAgentEffect } from "./root-agent-effect.js";

type InterpreterSession = Pick<
  RootAgentSessionController,
  "setCurrentApp" | "clearCurrentApp" | "enter"
>;

/** wait_for_event 超时时由 Interpreter 自己 push 进队列的 wake 事件类型。 */
type WakeEvent = Extract<Event, { type: "wake" }>;

/**
 * 主 Agent 的状态变更收口。所有"对 Agent 状态的变更"——上下文追加、currentApp
 * 切换、focused state 切换——都通过这里 apply。
 *
 * apply 的语义分两类：
 * - **即时副作用**：switch_app / switch_state / replace_messages / wait_for_event
 *   直接改 session 内部状态或 context、或阻塞 await 事件队列。
 * - **延迟追加**：append_message 不直接 `context.appendMessages`，而是把要追加的
 *   `LlmMessage` 收集到返回值的 `appendedMessages` 里，由 ReAct kernel 的原子
 *   commit 流程走。
 *
 * 这种"即时改 session / 延迟追加 message"的不对称是 KV 缓存友好的：message 追加
 * 必须经过 kernel 的原子 commit 才能保证一轮内消息顺序一致；session 字段变更
 * 与消息流无关，可以即时。
 *
 * 调用方包括：
 * - **kernel 内置消费**：每个工具跑完后立即调本类（由 kernel 拿到 `effects` 喂入）。
 * - **host 直接调用**：`RootAgentHost.compactContextIfNeeded` 在 context 压缩
 *   完成后产 `replace_messages` Effect 自己调本类。host 调时不期待 control 信号，
 *   不期待 appendedMessages（replace_messages 不产追加消息）。
 *
 * RootAgent 不产生 control 信号（`TControl=never`）——它的循环退出由事件队列 +
 * idle 状态决定，不由工具决定。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
 */
export class RootEffectInterpreter implements EffectInterpreter<LlmMessage, never> {
  private readonly session: InterpreterSession;
  private readonly context: AgentContext;
  private readonly eventQueue: Pick<AgentEventQueue, "enqueue" | "waitNonEmpty">;

  public constructor({
    session,
    context,
    eventQueue,
  }: {
    session: InterpreterSession;
    context: AgentContext;
    eventQueue: Pick<AgentEventQueue, "enqueue" | "waitNonEmpty">;
  }) {
    this.session = session;
    this.context = context;
    this.eventQueue = eventQueue;
  }

  /**
   * 按数组顺序逐个处理 Effect。中间某个 Effect 抛错时停止，已 apply 的不回滚。
   *
   * 返 `{ appendedMessages }`——所有 `append_message` 产出的 LlmMessage 顺序累积。
   * RootAgent 永远不产 control，返回值的 `control` 字段缺省。
   */
  public async apply(
    effects: readonly RootAgentEffect[],
  ): Promise<EffectInterpreterResult<LlmMessage, never>> {
    const appended: LlmMessage[] = [];
    for (const effect of effects) {
      appended.push(...(await this.applySingle(effect)));
    }
    return { appendedMessages: appended };
  }

  /**
   * 按 Effect 联合的 type 字段分发到具体处理逻辑。遇到不认识的 type 直接抛错
   * （不静默丢弃，避免业务上"以为生效了实际上没生效"）。
   *
   * 返回值：本次 apply 累积要追加到上下文的 LlmMessage[]（switch_* 这种即时
   * 变更返空数组）。
   */
  private async applySingle(effect: RootAgentEffect): Promise<LlmMessage[]> {
    switch (effect.type) {
      case "append_message":
        return [createUserMessage(effect.content)];
      case "switch_app":
        if (effect.appId === null) {
          this.session.clearCurrentApp();
        } else {
          this.session.setCurrentApp(effect.appId);
        }
        return [];
      case "switch_state":
        await this.session.enter({ id: effect.stateId });
        return [];
      case "replace_messages":
        // 昂贵动作：破坏 KV 缓存前缀。守门靠约定——仅
        // ContextCompactionExtension 这种系统组件应产生此 Effect。工具/钩子
        // 产 replace_messages 是 bug。
        await this.context.replaceMessages([...effect.messages]);
        return [];
      case "wait_for_event":
        // 阻塞 await 事件队列非空。super timer 起 wake 事件保证超时也会唤醒。
        // 事件本身不在这里消费——本 Effect 只负责"挂起 Agent 主循环"。事件路由
        // 由后续 LoopAgent 主循环 take + session.consumeIncomingEvent 处理。
        await this.waitForEventOrTimeout(effect.maxWaitMs);
        return [];
      default: {
        const exhaustive: never = effect;
        throw new Error(
          `RootEffectInterpreter does not handle Effect "${JSON.stringify(exhaustive)}". ` +
            `Likely the tool is attached to the wrong agent, or Interpreter needs extension.`,
        );
      }
    }
  }

  /**
   * 阻塞直到事件队列非空。同时启动一个内部 wake timer，超时后自己 push 一个
   * wake 事件——保证不会永久阻塞。事件被消费由调用方负责（LoopAgent 主循环），
   * 本方法只管"挂起"和"被唤醒"。
   */
  private async waitForEventOrTimeout(maxWaitMs: number): Promise<void> {
    const wakeEvent: WakeEvent = { type: "wake" };
    const timerHandle = setTimeout(() => {
      this.eventQueue.enqueue(wakeEvent);
    }, maxWaitMs);
    try {
      await this.eventQueue.waitNonEmpty();
    } finally {
      // 不管谁唤醒（真消息 / 别的 wake / 我们自己的 timer），都清 timer，
      // 避免 stale setTimeout 在远未来 enqueue 一个无谓的 wake。
      clearTimeout(timerHandle);
    }
  }
}
