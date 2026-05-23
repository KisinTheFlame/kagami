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
 * - **即时副作用**：switch_app / switch_state 直接改 session 内部状态（currentApp、
 *   stateStack）。返回空数组。
 * - **延迟追加**：append_message 不直接 context.appendMessages（避免和 ReAct
 *   kernel 的 commit 流程冲突），而是把要追加的 LlmMessage 返出去，由调用方
 *   （通常是 RootEffectsApplyExtension）走 kernel 的 appendedMessages 协议
 *   commit。
 *
 * 这种"即时改 session / 延迟追加 message"的不对称是 KV 缓存友好的：message 追加
 * 必须经过 kernel 的原子 commit 才能保证一轮内消息顺序一致；session 字段变更
 * 与消息流无关，可以即时。
 *
 * 产出方包括：
 * - 工具 execute()（通过 ToolExecutionResult.effects 透传）
 * - App.onFocus / onBlur 钩子（由 EnterTool / BackToPortalTool 展开后塞进自己的
 *   effects 列表）
 * - state.handleEvent（未来阶段 4）
 * - LoopAgent extension（如未来阶段 5 的 ContextCompactionExtension）
 *
 * 不管哪类产出方，最终都调本类的 apply。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md)。
 */
export class RootEffectInterpreter {
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
   * 按 Effect 联合的 type 字段分发到具体处理逻辑。遇到不认识的 type 直接抛错
   * （不静默丢弃，避免业务上"以为生效了实际上没生效"）。
   *
   * 返回值：本次 apply 累积要追加到上下文的 LlmMessage[]（switch_* 这种即时
   * 变更返空数组）。
   */
  public async apply(effect: RootAgentEffect): Promise<LlmMessage[]> {
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
   * 按数组顺序逐个 apply，累积返回所有 append_message 产出的消息。中间某个
   * Effect 抛错时停止，已 apply 的不回滚。
   */
  public async applyAll(effects: readonly RootAgentEffect[]): Promise<LlmMessage[]> {
    const collected: LlmMessage[] = [];
    for (const effect of effects) {
      collected.push(...(await this.apply(effect)));
    }
    return collected;
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
