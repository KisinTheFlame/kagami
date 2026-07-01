import type { AppId, AppManager } from "@kagami/agent-runtime";
import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "@kagami/llm-client";
import {
  createAsyncToolResultMessage,
  createNotificationMessage,
  createPortalReminderMessage,
  createStoryRecallMessage,
} from "../../context/context-message-factory.js";
import type { Event } from "../../event/event.js";

/**
 * 手机 OS 模型下，session 退化为「App 启动器 + 顶层事件路由」：聊天已经 App 化
 * （QqApp 自管会话、订阅 napcat、收消息向 NotificationCenter push 通知），状态树退役。
 *
 * session 只剩：
 * - Portal（桌面）+ currentApp（当前进入的 App）这一个焦点维度；
 * - 顶层事件路由（wake / story_recall / notification）——napcat 消息不再走这里，
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
  clearCurrentApp(): void;
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
  /** 当前已 enter 的 App id。仅内存持有；不进 snapshot；reset 回 undefined（即 Portal）。 */
  private currentApp: AppId | undefined = undefined;

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

  public clearCurrentApp(): void {
    this.currentApp = undefined;
  }

  public reset(): void {
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.initialized = false;
    this.currentApp = undefined;
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

    if (event.type === "story_recall_completed") {
      this.pendingIncomingMessages.push(createStoryRecallMessage(event.data.stories));
      return { shouldTriggerRound: true };
    }

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
