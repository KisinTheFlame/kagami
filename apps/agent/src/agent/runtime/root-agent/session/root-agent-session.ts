import type { AppId, AppManager } from "@kagami/agent-runtime";
import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "@kagami/llm-client";
import {
  createAsyncToolResultMessage,
  createInnerThoughtMessage,
  createNotificationMessage,
  createPortalReminderMessage,
} from "../../context/context-message-factory.js";
import type { Event } from "../../event/event.js";

/**
 * 手机 OS 模型下，session 退化为「App 启动器 + 顶层事件路由」：聊天已经 App 化
 * （QqApp 自管会话、订阅 napcat、收消息向 NotificationCenter push 通知），状态树退役。
 *
 * session 只剩：
 * - Portal（桌面）+ currentApp（当前进入的 App）这一个焦点维度；
 * - 顶层事件路由（wake / async_tool_result / notification）——napcat 消息不再走这里，
 *   由 QqApp 直接接收。
 *
 * 聊天目标（send_message 的发送会话）属于 QqApp 的私有概念，由 QqApp 自管，不再经 session
 * 转发。
 */

export type RootAgentPostToolEffects = {
  messages: LlmMessage[];
};

export type RootAgentSessionController = {
  getCurrentApp(): AppId | undefined;
  setCurrentApp(appId: AppId): void;
  /** 本桶上下文里是否进入过该 App（决定 switch 时要不要自动吐 help）。 */
  hasEnteredApp(appId: AppId): boolean;
  /** 标记该 App 本桶已进入。由 switch_app effect 在解释期调用，保持工具无副作用。 */
  markAppEntered(appId: AppId): void;
  /** 清空「已进入 App」集合。上下文压缩时调用，让压缩后首进重新吐 help。 */
  clearEnteredApps(): void;
  reset(): void;
  markRestored(): void;
  initializeContext(): Promise<void>;
  consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects>;
};

type RootAgentSessionDeps = {
  context: AgentContext;
  /** Portal 渲染时枚举已注册 Apps 喂给 reminder 消息。 */
  appManager?: AppManager;
};

export class RootAgentSession implements RootAgentSessionController {
  private readonly context: AgentContext;
  private readonly appManager: AppManager | null;
  private readonly pendingIncomingMessages: LlmMessage[] = [];
  private readonly pendingPostToolMessages: LlmMessage[] = [];
  private initialized = false;
  /**
   * 当前所在 App id。仅内存持有；不进 snapshot。undefined = Portal（桌面），只在初始
   * 状态出现；一旦 switch 进某个 App 就不再为空（除 reset 重启回到初始）。
   */
  private currentApp: AppId | undefined = undefined;
  /**
   * 本桶上下文里已进入过的 App 集合。仅内存持有；不进 snapshot，生命周期与 currentApp
   * 一致（reset / markRestored 清空）。压缩时由 AppEntryResetExtension 清空，让压缩后首进
   * 重新吐 help。重启后为空——首进各 App 至多重复注入一次 help（有界，见 issue #223）。
   */
  private readonly enteredApps = new Set<AppId>();

  public constructor({ context, appManager }: RootAgentSessionDeps) {
    this.context = context;
    this.appManager = appManager ?? null;
  }

  public getCurrentApp(): AppId | undefined {
    return this.currentApp;
  }

  public setCurrentApp(appId: AppId): void {
    this.currentApp = appId;
  }

  public hasEnteredApp(appId: AppId): boolean {
    return this.enteredApps.has(appId);
  }

  public markAppEntered(appId: AppId): void {
    this.enteredApps.add(appId);
  }

  public clearEnteredApps(): void {
    this.enteredApps.clear();
  }

  public reset(): void {
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.initialized = false;
    this.currentApp = undefined;
    this.enteredApps.clear();
  }

  /**
   * 从持久化快照恢复后调用：上下文已含上一会话的 portal reminder，标记 initialized 避免
   * initializeContext 重复追加（会污染稳定前缀、破坏 KV 缓存）。session 自身无持久化状态，
   * 故只重置内存态。
   */
  public markRestored(): void {
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.initialized = true;
    this.currentApp = undefined;
    this.enteredApps.clear();
  }

  public async initializeContext(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const apps = (this.appManager?.getAllApps() ?? []).map(app => ({
      id: app.id,
      displayName: app.displayName,
    }));
    await this.context.appendMessages([createPortalReminderMessage({ apps })]);
    this.initialized = true;
  }

  public async consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    if (event.type === "async_tool_result_completed") {
      // 异步工具任务完成：装配成 <async_tool_result> 消息追加到尾部，触发一轮 round。
      this.pendingIncomingMessages.push(createAsyncToolResultMessage(event.data));
      return { shouldTriggerRound: true };
    }

    if (event.type === "notification") {
      // NotificationCenter 聚合后塞进队列的统一通知（手机 OS 模型）。装配成一条
      // <notification> 消息追加到尾部，触发一轮 round。
      this.pendingIncomingMessages.push(createNotificationMessage(event.data.lines));
      return { shouldTriggerRound: true };
    }

    if (event.type === "inner_thought") {
      // 内心独白（issue #265）：装配成 <inner_thought> 消息追加到尾部，触发一轮 round。
      this.pendingIncomingMessages.push(createInnerThoughtMessage(event.data.thought));
      return { shouldTriggerRound: true };
    }

    // wake：纯唤醒标记，session 不做事。napcat 消息 / friend_list 不再走 session
    // （由 QqApp 直接接收），万一到这里也忽略。
    return { shouldTriggerRound: false };
  }

  public async flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    const shouldTriggerRound = this.pendingIncomingMessages.length > 0;
    if (this.pendingIncomingMessages.length > 0) {
      await this.context.appendMessages(this.pendingIncomingMessages);
      this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    }
    return { shouldTriggerRound };
  }

  public async flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects> {
    await this.initializeContext();
    return {
      messages: this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length),
    };
  }
}
