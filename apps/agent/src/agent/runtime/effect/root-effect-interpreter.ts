import {
  HandlerEffectInterpreter,
  ReplaceLeadingMessagesHandler,
  type Effect,
  type EffectHandler,
  type EffectHandlerResult,
  type EffectInterpreter,
} from "@kagami/agent-runtime";
import type { AgentContext } from "../context/agent-context.js";
import type { Event } from "../event/event.js";
import type { AgentEventQueue } from "../event/event.queue.js";
import { createUserMessage, createUserImageMessage } from "../context/context-message-factory.js";
import type { RootAgentSessionController } from "../root-agent/session/root-agent-session.js";
import type {
  AppendMessageEffect,
  SwitchAppEffect,
  WaitForEventEffect,
} from "./root-agent-effect.js";

type InterpreterSession = Pick<RootAgentSessionController, "setCurrentApp" | "markAppEntered">;

function isAppendMessageEffect(effect: Effect): effect is AppendMessageEffect {
  return effect.type === "append_message";
}

function isSwitchAppEffect(effect: Effect): effect is SwitchAppEffect {
  return effect.type === "switch_app";
}

function isWaitForEventEffect(effect: Effect): effect is WaitForEventEffect {
  return effect.type === "wait_for_event";
}

/** wait_for_event 超时时由 Interpreter 自己 push 进队列的 wake 事件类型。 */
type WakeEvent = Extract<Event, { type: "wake" }>;

/**
 * RootAgent 的 EffectInterpreter：主 Agent 所有"对状态的变更"（上下文追加、
 * currentApp 切换、focused state 切换、阻塞等待、上下文重建）都通过它 apply。
 *
 * 由一组 handler 组成。复用粒度是 handler：
 * - `ReplaceLeadingMessagesHandler`（公共，来自 agent-runtime）：处理
 *   replace_leading_messages，直接调 context.replaceLeadingMessages。任何做上下文
 *   压缩的 Agent（当前是 RootAgent）都能复用它。
 * - RootAgent 专属 handler：append_message / switch_app / switch_state /
 *   wait_for_event——这些副作用语义只属于主 Agent。
 *
 * 即时 vs 延迟的不对称（KV 缓存友好）：
 * - **即时副作用**：switch_app / switch_state / replace_messages / wait_for_event
 *   直接改 session / context / 阻塞 await，不返消息。
 * - **延迟追加**：append_message 不直接 context.appendMessages，而是把消息放进
 *   handler 结果的 appendedMessages，由 ReActKernel 的原子 commit 流程统一追加，
 *   保证一轮内消息顺序一致。
 */
export function createRootEffectInterpreter({
  session,
  context,
  eventQueue,
}: {
  session: InterpreterSession;
  context: AgentContext;
  eventQueue: Pick<AgentEventQueue, "enqueue" | "waitNonEmpty">;
}): EffectInterpreter<never> {
  return new HandlerEffectInterpreter<never>([
    new ReplaceLeadingMessagesHandler(context),
    new AppendMessageHandler(),
    new SwitchAppHandler(session),
    new WaitForEventHandler(eventQueue),
  ]);
}

/**
 * 把 content（一段字符串）以 role=user 追加到上下文尾部。
 *
 * 延迟追加：不直接调 context，返 appendedMessages 让 kernel 原子 commit。这是
 * RootAgent 专属——它和 kernel 的 commit 协议耦合（公共的"直接写 context"
 * append 语义不适用）。
 */
class AppendMessageHandler implements EffectHandler<never> {
  public matches(effect: Effect): boolean {
    return isAppendMessageEffect(effect);
  }

  public async handle(effect: Effect): Promise<EffectHandlerResult<never>> {
    if (!isAppendMessageEffect(effect)) {
      throw new Error(`AppendMessageHandler received non-append effect: ${effect.type}`);
    }
    const append = effect;
    if (append.image) {
      return {
        appendedMessages: [createUserImageMessage(append.content, append.image)],
      };
    }
    return { appendedMessages: [createUserMessage(append.content)] };
  }
}

/**
 * 把 root agent 的 currentApp 切到 appId，并标记该 App 本桶已进入。即时副作用。
 *
 * markAppEntered 落在这里（而非 SwitchTool）是为了保持工具无副作用：SwitchTool 只
 * 读 hasEnteredApp 决定要不要吐 help，真正的状态变更统一走 effect 解释期。
 */
class SwitchAppHandler implements EffectHandler<never> {
  private readonly session: InterpreterSession;

  public constructor(session: InterpreterSession) {
    this.session = session;
  }

  public matches(effect: Effect): boolean {
    return isSwitchAppEffect(effect);
  }

  public async handle(effect: Effect): Promise<EffectHandlerResult<never>> {
    if (!isSwitchAppEffect(effect)) {
      throw new Error(`SwitchAppHandler received non-switch_app effect: ${effect.type}`);
    }
    this.session.setCurrentApp(effect.appId);
    this.session.markAppEntered(effect.appId);
    return {};
  }
}

/**
 * 把当前 Agent 主循环挂起，阻塞 await 事件队列非空。内部 wake timer 保证超时也会
 * 唤醒。事件本身不在这里消费——本 handler 只负责"挂起 Agent 主循环"，事件路由
 * 由后续 LoopAgent 主循环 take + session.consumeIncomingEvent 处理。
 */
class WaitForEventHandler implements EffectHandler<never> {
  private readonly eventQueue: Pick<AgentEventQueue, "enqueue" | "waitNonEmpty">;

  public constructor(eventQueue: Pick<AgentEventQueue, "enqueue" | "waitNonEmpty">) {
    this.eventQueue = eventQueue;
  }

  public matches(effect: Effect): boolean {
    return isWaitForEventEffect(effect);
  }

  public async handle(effect: Effect): Promise<EffectHandlerResult<never>> {
    if (!isWaitForEventEffect(effect)) {
      throw new Error(`WaitForEventHandler received non-wait_for_event effect: ${effect.type}`);
    }
    const wait = effect;
    const wakeEvent: WakeEvent = { type: "wake" };
    const timerHandle = setTimeout(() => {
      this.eventQueue.enqueue(wakeEvent);
    }, wait.maxWaitMs);
    try {
      await this.eventQueue.waitNonEmpty();
    } finally {
      // 不管谁唤醒（真消息 / 别的 wake / 我们自己的 timer），都清 timer，
      // 避免 stale setTimeout 在远未来 enqueue 一个无谓的 wake。
      clearTimeout(timerHandle);
    }
    return {};
  }
}
