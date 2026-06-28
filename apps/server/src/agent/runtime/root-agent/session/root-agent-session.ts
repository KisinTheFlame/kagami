import type { AppId, AppManager } from "@kagami/agent-runtime";
import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "../../../../llm/types.js";
import {
  createAsyncToolResultMessage,
  createNotificationMessage,
  createPortalReminderMessage,
  createStoryRecallMessage,
} from "../../context/context-message-factory.js";
import type { Event } from "../../event/event.js";
import type { NapcatChatTarget } from "../../../../napcat/application/napcat-gateway.service.js";
import type {
  CurrentPersistedRootAgentSessionSnapshot,
  PersistedRootAgentSessionSnapshot,
} from "../persistence/root-agent-runtime-snapshot.js";

/**
 * 手机 OS 模型下，session 退化为「App 启动器 + 顶层事件路由」：聊天已经 App 化
 * （QqApp 自管会话、订阅 napcat、收消息向 NotificationCenter push 通知），状态树退役。
 *
 * session 只剩：
 * - Portal（桌面）+ currentApp（当前进入的 App）这一个焦点维度；
 * - 顶层事件路由（wake / story_recall / notification）——napcat 消息不再走这里，
 *   由 QqApp 直接接收；
 * - send_message 的 chatTarget 委派给当前 App（QqApp 的当前会话）。
 */

const PORTAL_STATE_ID = "portal";

export type RootAgentSessionState = {
  focusedStateId: string;
  stateStack: string[];
};

export type RootAgentPostToolEffects = {
  messages: LlmMessage[];
};

export type RootAgentSessionStateView = {
  focusedStateId: string;
  focusedStateDisplayName: string;
  stateStack: Array<{ id: string; displayName: string }>;
  children: Array<{ id: string; displayName: string; description: string }>;
  availableInvokeTools: string[];
};

export type RootAgentSessionController = {
  getState(): RootAgentSessionState;
  getFocusedStateId(): string;
  getCurrentApp(): AppId | undefined;
  setCurrentApp(appId: AppId): void;
  clearCurrentApp(): void;
  getCurrentChatTarget(): NapcatChatTarget | undefined;
  getCurrentGroupId(): string | undefined;
  getAvailableInvokeTools(): string[];
  getStateView(): Promise<RootAgentSessionStateView>;
  exportPersistedSnapshot(): CurrentPersistedRootAgentSessionSnapshot;
  restorePersistedSnapshot(snapshot: PersistedRootAgentSessionSnapshot): void;
  reset(): void;
  initializeContext(): Promise<void>;
  consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects>;
};

type RootAgentSessionDeps = {
  context: AgentContext;
  /** Portal 渲染时枚举已注册 Apps 喂给 reminder 消息。 */
  appManager?: AppManager;
  /** send_message 的目标：委派给当前 App（QqApp 的当前会话）。 */
  chatTargetProvider?: () => NapcatChatTarget | undefined;
};

export class RootAgentSession implements RootAgentSessionController {
  private readonly context: AgentContext;
  private readonly appManager: AppManager | null;
  private readonly chatTargetProvider: (() => NapcatChatTarget | undefined) | null;
  private readonly pendingIncomingMessages: LlmMessage[] = [];
  private readonly pendingPostToolMessages: LlmMessage[] = [];
  private initialized = false;
  /** 当前已 enter 的 App id。仅内存持有；不进 snapshot；reset 回 undefined（即 Portal）。 */
  private currentApp: AppId | undefined = undefined;

  public constructor({ context, appManager, chatTargetProvider }: RootAgentSessionDeps) {
    this.context = context;
    this.appManager = appManager ?? null;
    this.chatTargetProvider = chatTargetProvider ?? null;
  }

  public getState(): RootAgentSessionState {
    return { focusedStateId: PORTAL_STATE_ID, stateStack: [PORTAL_STATE_ID] };
  }

  public getFocusedStateId(): string {
    return PORTAL_STATE_ID;
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

  public getCurrentChatTarget(): NapcatChatTarget | undefined {
    return this.chatTargetProvider?.() ?? undefined;
  }

  public getCurrentGroupId(): string | undefined {
    const chatTarget = this.getCurrentChatTarget();
    return chatTarget?.chatType === "group" ? chatTarget.groupId : undefined;
  }

  public getAvailableInvokeTools(): string[] {
    return [];
  }

  public async getStateView(): Promise<RootAgentSessionStateView> {
    await this.initializeContext();
    return {
      focusedStateId: PORTAL_STATE_ID,
      focusedStateDisplayName: "门户",
      stateStack: [{ id: PORTAL_STATE_ID, displayName: "门户" }],
      children: [],
      availableInvokeTools: [],
    };
  }

  public exportPersistedSnapshot(): CurrentPersistedRootAgentSessionSnapshot {
    return { stateStack: [PORTAL_STATE_ID] };
  }

  public restorePersistedSnapshot(_snapshot: PersistedRootAgentSessionSnapshot): void {
    // 手机 OS 模型下 session 不再持聊天状态；旧快照里的 groups/privateChats/stateStack
    // 一律忽略（会话状态归 QqApp，本次采用重置）。
    void _snapshot;
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.initialized = true;
    this.currentApp = undefined;
  }

  public reset(): void {
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.initialized = false;
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
