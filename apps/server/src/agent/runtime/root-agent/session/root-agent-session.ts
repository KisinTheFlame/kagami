import type { AppId } from "@kagami/agent-runtime";
import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "../../../../llm/types.js";
import {
  createCrossStateNotificationMessage,
  createIthomeArticleDetailMessage,
  createStateSystemReminderMessage,
} from "../../context/context-message-factory.js";
import { NotificationAccumulator } from "../notification/notification-accumulator.js";
import type { Event } from "../../event/event.js";
import type {
  NapcatChatTarget,
  NapcatFriendInfo,
  NapcatGatewayService,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";
import type { IthomeNewsService } from "../../../../news/application/ithome-news.service.js";
import type { TerminalService } from "../../../capabilities/terminal/application/terminal.service.js";
import { GroupChatState } from "./group-chat-state.js";
import { PrivateChatState } from "./private-chat-state.js";
import { normalizePersistedSnapshot } from "./persistence-normalize.js";
import {
  createQqGroupStateId,
  createQqPrivateStateId,
  normalizeEnterInputToStateId,
  parseGroupIdFromStateId,
  parsePrivateUserIdFromStateId,
} from "./state-id.js";
import {
  type RootAgentInvokeToolName,
  type RootAgentState,
  type RootAgentStateHost,
  type RootAgentStateId,
} from "./state.types.js";
import { IthomeState } from "./states/ithome.state.js";
import { PortalState } from "./states/portal.state.js";
import { QqGroupState } from "./states/qq-group.state.js";
import { QqPrivateState } from "./states/qq-private.state.js";
import { TerminalStateNode } from "./states/terminal.state.js";
import type {
  CurrentPersistedRootAgentSessionSnapshot,
  PersistedRootAgentIthomeFeedState,
  PersistedRootAgentSessionSnapshot,
} from "../persistence/root-agent-runtime-snapshot.js";

export type RootAgentSessionState = {
  focusedStateId: RootAgentStateId;
  stateStack: RootAgentStateId[];
};

export type RootAgentPostToolEffects = {
  messages: LlmMessage[];
  events: Event[];
};

export type RootAgentSessionDashboardSnapshot = {
  focusedStateId: RootAgentStateId;
  focusedStateDisplayName: string;
  focusedStateDescription: string;
  stateStack: Array<{
    id: RootAgentStateId;
    displayName: string;
  }>;
  children: Array<{
    id: RootAgentStateId;
    displayName: string;
    description: string;
  }>;
  availableInvokeTools: RootAgentInvokeToolName[];
};

export type RootAgentSessionController = {
  getState(): RootAgentSessionState;
  getFocusedStateId(): RootAgentStateId;
  /**
   * 当前 Kagami 已 enter 的 App。未进入任何 App 时返回 undefined。
   * App 框架 Phase 1 字段。不进 snapshot，重启回 undefined（即 Portal）。
   */
  getCurrentApp(): AppId | undefined;
  setCurrentApp(appId: AppId): void;
  clearCurrentApp(): void;
  getCurrentChatTarget(): NapcatChatTarget | undefined;
  getCurrentGroupId(): string | undefined;
  getAvailableInvokeTools(): RootAgentInvokeToolName[];
  getDashboardSnapshot(): Promise<RootAgentSessionDashboardSnapshot>;
  exportPersistedSnapshot(): CurrentPersistedRootAgentSessionSnapshot;
  restorePersistedSnapshot(snapshot: PersistedRootAgentSessionSnapshot): void;
  reset(): void;
  initializeContext(): Promise<void>;
  consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects>;
  enter(
    input:
      | { id: string }
      | {
          kind: "qq_group" | "qq_private" | "ithome" | "terminal";
          id?: string;
        },
  ): Promise<Record<string, unknown>>;
  openIthomeArticle(input: { articleId: number }): Promise<Record<string, unknown>>;
  back(): Promise<Record<string, unknown>>;
  backToPortal?(): Promise<Record<string, unknown>>;
};

type RootAgentSessionDeps = {
  context: AgentContext;
  napcatGatewayService: NapcatGatewayService;
  listenGroupIds: string[];
  recentMessageLimit: number;
  notificationTimeWindowMs?: number;
  ithomeNewsService?: Pick<IthomeNewsService, "getFeedOverview" | "enterFeed" | "openArticle">;
  terminalService?: Pick<TerminalService, "getCwd">;
};

const DEFAULT_NOTIFICATION_TIME_WINDOW_MS = 30_000;

export class RootAgentSession implements RootAgentSessionController, RootAgentStateHost {
  private readonly context: AgentContext;
  private readonly napcatGatewayService: NapcatGatewayService;
  private readonly recentMessageLimit: number;
  public readonly ithomeNewsService: Pick<
    IthomeNewsService,
    "getFeedOverview" | "enterFeed" | "openArticle"
  > | null;
  public readonly terminalService: Pick<TerminalService, "getCwd"> | null;
  public readonly groupStates: GroupChatState[];
  public readonly groupStateById: Map<string, GroupChatState>;
  public readonly privateChatStates: PrivateChatState[] = [];
  public readonly privateChatStateByUserId = new Map<string, PrivateChatState>();
  private readonly pendingVisibleEvents: Event[] = [];
  private readonly pendingIncomingMessages: LlmMessage[] = [];
  private readonly pendingPostToolMessages: LlmMessage[] = [];
  private readonly pendingPostToolEvents: Event[] = [];
  private stateStack: RootAgentStateId[] = ["portal"];
  private initialized = false;
  private groupInfoLoaded = false;
  public ithomeFeedState: PersistedRootAgentIthomeFeedState | null = null;
  private readonly notificationAccumulator: NotificationAccumulator;
  /**
   * App 框架 Phase 1 字段：当前 Kagami 已 enter 的 App id。
   * 仅在内存中持有；不进 snapshot；reset 时一并清空。
   */
  private currentApp: AppId | undefined = undefined;

  public constructor({
    context,
    napcatGatewayService,
    listenGroupIds,
    recentMessageLimit,
    notificationTimeWindowMs,
    ithomeNewsService,
    terminalService,
  }: RootAgentSessionDeps) {
    this.context = context;
    this.napcatGatewayService = napcatGatewayService;
    this.recentMessageLimit = recentMessageLimit;
    this.ithomeNewsService = ithomeNewsService ?? null;
    this.terminalService = terminalService ?? null;
    this.notificationAccumulator = new NotificationAccumulator({
      timeWindowMs: notificationTimeWindowMs ?? DEFAULT_NOTIFICATION_TIME_WINDOW_MS,
    });
    this.groupStates = listenGroupIds.map(
      groupId =>
        new GroupChatState({
          groupId,
          unreadLimit: recentMessageLimit,
        }),
    );
    this.groupStateById = new Map(this.groupStates.map(state => [state.groupId, state]));
  }

  public getState(): RootAgentSessionState {
    return {
      focusedStateId: this.getFocusedStateId(),
      stateStack: [...this.stateStack],
    };
  }

  public getFocusedStateId(): RootAgentStateId {
    return this.stateStack.at(-1) ?? "portal";
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
    const focusedStateId = this.getFocusedStateId();
    const groupId = parseGroupIdFromStateId(focusedStateId);
    if (groupId) {
      return {
        chatType: "group",
        groupId,
      };
    }

    const userId = parsePrivateUserIdFromStateId(focusedStateId);
    if (userId) {
      return {
        chatType: "private",
        userId,
      };
    }

    return undefined;
  }

  public getCurrentGroupId(): string | undefined {
    const chatTarget = this.getCurrentChatTarget();
    return chatTarget?.chatType === "group" ? chatTarget.groupId : undefined;
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    const focusedState = this.requireState(this.getFocusedStateId());
    return [...focusedState.getAvailableInvokeTools()];
  }

  public async getDashboardSnapshot(): Promise<RootAgentSessionDashboardSnapshot> {
    await this.initializeContext();

    const focusedState = this.requireState(this.getFocusedStateId());
    const children = await focusedState.listChildren();

    return {
      focusedStateId: focusedState.getId(),
      focusedStateDisplayName: focusedState.getDisplayName(),
      focusedStateDescription: await focusedState.getDescription(),
      stateStack: this.stateStack.map(stateId => {
        const state = this.requireState(stateId);
        return {
          id: stateId,
          displayName: state.getDisplayName(),
        };
      }),
      children: await Promise.all(
        children.map(async child => ({
          id: child.getId(),
          displayName: child.getDisplayName(),
          description: await child.getDescription(),
        })),
      ),
      availableInvokeTools: this.getAvailableInvokeTools(),
    };
  }

  public exportPersistedSnapshot(): CurrentPersistedRootAgentSessionSnapshot {
    return {
      stateStack: [...this.stateStack],
      groups: this.groupStates.map(groupState => ({
        groupId: groupState.groupId,
        groupInfo: groupState.getGroupInfo(),
        unreadMessages: groupState.getUnreadMessages(),
        hasEntered: groupState.hasEntered(),
      })),
      privateChats: this.privateChatStates.map(privateChatState => ({
        userId: privateChatState.userId,
        friendInfo: privateChatState.getFriendInfo(),
        unreadMessages: privateChatState.getUnreadMessages(),
        hasEntered: privateChatState.hasEntered(),
      })),
      ithomeFeedState: this.ithomeFeedState ? { ...this.ithomeFeedState } : null,
    };
  }

  public restorePersistedSnapshot(snapshot: PersistedRootAgentSessionSnapshot): void {
    const normalizedSnapshot = normalizePersistedSnapshot(
      snapshot,
      this.groupStateById,
      this.privateChatStateByUserId,
    );

    for (const groupState of this.groupStates) {
      groupState.restoreSnapshot({
        groupInfo: null,
        unreadMessages: [],
        hasEntered: false,
      });
    }

    this.privateChatStates.splice(0, this.privateChatStates.length);
    this.privateChatStateByUserId.clear();

    for (const persistedGroupState of normalizedSnapshot.groups) {
      const groupState = this.groupStateById.get(persistedGroupState.groupId);
      if (!groupState) {
        continue;
      }

      groupState.restoreSnapshot({
        groupInfo: persistedGroupState.groupInfo,
        unreadMessages: persistedGroupState.unreadMessages,
        hasEntered: persistedGroupState.hasEntered,
      });
    }

    for (const persistedPrivateChat of normalizedSnapshot.privateChats) {
      const privateChatState = this.ensurePrivateChatState({
        userId: persistedPrivateChat.userId,
        friendInfo: persistedPrivateChat.friendInfo,
      });
      privateChatState.restoreSnapshot({
        friendInfo: persistedPrivateChat.friendInfo,
        unreadMessages: persistedPrivateChat.unreadMessages,
        hasEntered: persistedPrivateChat.hasEntered,
      });
    }

    this.pendingVisibleEvents.splice(0, this.pendingVisibleEvents.length);
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.pendingPostToolEvents.splice(0, this.pendingPostToolEvents.length);
    this.groupInfoLoaded = normalizedSnapshot.groupInfoLoaded;
    this.ithomeFeedState = normalizedSnapshot.ithomeFeedState;
    this.initialized = true;
    this.stateStack = normalizedSnapshot.stateStack;
    // currentApp 不进 snapshot，重启统一回到 undefined（即 Portal）。
    this.currentApp = undefined;
  }

  public reset(): void {
    for (const groupState of this.groupStates) {
      groupState.reset();
    }
    this.privateChatStates.splice(0, this.privateChatStates.length);
    this.privateChatStateByUserId.clear();

    this.pendingVisibleEvents.splice(0, this.pendingVisibleEvents.length);
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.pendingPostToolEvents.splice(0, this.pendingPostToolEvents.length);
    this.groupInfoLoaded = false;
    this.ithomeFeedState = null;
    this.initialized = false;
    this.stateStack = ["portal"];
    this.currentApp = undefined;
  }

  public async initializeContext(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.ensureGroupInfosLoaded();
    await this.ensureIthomeFeedStateLoaded();
    await this.context.appendMessages(
      await this.renderFocusMessages(this.getFocusedStateId(), "initialize"),
    );
    this.initialized = true;
  }

  public async consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    if (event.type === "napcat_friend_list_updated") {
      this.syncPrivateChatsFromFriendList(event.data.friends);
      return {
        shouldTriggerRound: false,
      };
    }

    if (event.type === "wake") {
      // Pure wake marker, produced by timers / stop / reset. The act of
      // dequeuing it already woke any consumer; session does nothing.
      return {
        shouldTriggerRound: false,
      };
    }

    return await this.consumeIncomingEventInActiveState(event);
  }

  public async flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    // Flush cross-state notifications BEFORE shouldTriggerRound calculation.
    // This ensures notification messages are counted in shouldTriggerRound.
    const flushedNotifications = this.notificationAccumulator.tryFlush();
    if (flushedNotifications !== null && flushedNotifications.length > 0) {
      this.pendingIncomingMessages.push(createCrossStateNotificationMessage(flushedNotifications));
    }

    const shouldTriggerRound =
      this.pendingIncomingMessages.length > 0 || this.pendingVisibleEvents.length > 0;

    if (this.pendingIncomingMessages.length > 0) {
      await this.context.appendMessages(this.pendingIncomingMessages);
      this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    }

    if (this.pendingVisibleEvents.length > 0) {
      await this.context.appendEvents(this.pendingVisibleEvents);
      this.pendingVisibleEvents.splice(0, this.pendingVisibleEvents.length);
    }

    return {
      shouldTriggerRound,
    };
  }

  public async flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects> {
    await this.initializeContext();

    return {
      messages: this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length),
      events: this.pendingPostToolEvents.splice(0, this.pendingPostToolEvents.length),
    };
  }

  public async enter(
    input:
      | { id: string }
      | {
          kind: "qq_group" | "qq_private" | "ithome" | "terminal";
          id?: string;
        },
  ): Promise<Record<string, unknown>> {
    await this.initializeContext();

    const targetStateId = normalizeEnterInputToStateId(input);
    if (!targetStateId) {
      return {
        ok: false,
        error: "ENTER_TARGET_NOT_AVAILABLE",
      };
    }

    const targetState = this.resolveState(targetStateId.trim());
    if (!targetState) {
      return {
        ok: false,
        error: "ENTER_TARGET_NOT_AVAILABLE",
        id: targetStateId,
      };
    }

    const focusedState = this.requireState(this.getFocusedStateId());
    const children = await focusedState.listChildren();
    if (!children.some(child => child.getId() === targetState.getId())) {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
        id: targetState.getId(),
      };
    }

    this.pendingPostToolMessages.push(...(await focusedState.onBlur({ reason: "enter_child" })));
    this.stateStack.push(targetState.getId());
    this.notificationAccumulator.clearForState(targetState.getId());
    this.pendingPostToolMessages.push(
      ...(await this.renderFocusMessages(targetState.getId(), "enter")),
    );

    const displayName = targetState.getDisplayName();
    return {
      ok: true,
      id: targetState.getId(),
      displayName,
      message: `已进入${displayName}`,
    };
  }

  public async openIthomeArticle(input: { articleId: number }): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.getFocusedStateId() !== "ithome") {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    if (!this.ithomeNewsService) {
      return {
        ok: false,
        error: "ENTER_TARGET_NOT_AVAILABLE",
        id: "ithome",
      };
    }

    const article = await this.ithomeNewsService.openArticle({
      articleId: input.articleId,
    });
    if (!article) {
      return {
        ok: false,
        error: "ARTICLE_NOT_FOUND",
        articleId: input.articleId,
      };
    }

    this.pendingPostToolMessages.push(
      createIthomeArticleDetailMessage({
        title: article.title,
        url: article.url,
        publishedAt: article.publishedAt,
        content: article.content,
        contentSource: article.contentSource,
        truncated: article.truncated,
        maxChars: article.maxChars,
      }),
    );

    return {
      ok: true,
      kind: "ithome_article",
      articleId: article.articleId,
      contentSource: article.contentSource,
      truncated: article.truncated,
    };
  }

  public async back(): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.stateStack.length <= 1) {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    const currentState = this.requireState(this.getFocusedStateId());
    this.pendingPostToolMessages.push(...(await currentState.onBlur({ reason: "back" })));
    const exitedStateId = this.stateStack.pop() ?? "portal";
    const resumedStateId = this.getFocusedStateId();
    this.pendingPostToolMessages.push(
      ...(await this.renderFocusMessages(resumedStateId, "resume_back")),
    );

    const displayName = currentState.getDisplayName();
    return {
      ok: true,
      id: exitedStateId,
      displayName,
      message: `已退出${displayName}`,
    };
  }

  public async backToPortal(): Promise<Record<string, unknown>> {
    return await this.back();
  }

  public async fetchRecentMessages(groupId: string): Promise<NapcatGroupMessageData[]> {
    if (this.recentMessageLimit === 0) {
      return [];
    }

    return await this.napcatGatewayService.getRecentGroupMessages({
      groupId,
      count: this.recentMessageLimit,
    });
  }

  public async fetchRecentPrivateMessages(userId: string): Promise<NapcatPrivateMessageData[]> {
    if (this.recentMessageLimit === 0) {
      return [];
    }

    const friendInfo = this.privateChatStateByUserId.get(userId)?.getFriendInfo();
    const messages = await this.napcatGatewayService.getRecentPrivateMessages({
      userId,
      count: this.recentMessageLimit,
    });

    return messages
      .filter(
        (message): message is typeof message & { userId: string } =>
          message.messageType === "private" && message.userId === userId,
      )
      .map(message => ({
        userId,
        nickname: message.nickname ?? friendInfo?.nickname ?? userId,
        remark: friendInfo?.remark ?? null,
        rawMessage: message.rawMessage,
        messageSegments: message.messageSegments,
        messageId: message.messageId,
        time: message.time,
      }));
  }

  public async ensureGroupInfosLoaded(): Promise<void> {
    if (this.groupInfoLoaded) {
      return;
    }

    await Promise.all(
      this.groupStates.map(async groupState => {
        try {
          const groupInfo = await this.napcatGatewayService.getGroupInfo({
            groupId: groupState.groupId,
          });
          groupState.setGroupInfo(groupInfo);
        } catch {
          // Fallback to groupId-only rendering when group info is unavailable.
        }
      }),
    );
    this.groupInfoLoaded = true;
  }

  public async ensureIthomeFeedStateLoaded(): Promise<void> {
    if (!this.ithomeNewsService || this.ithomeFeedState) {
      return;
    }

    const overview = await this.ithomeNewsService.getFeedOverview();
    this.ithomeFeedState = {
      kind: "ithome",
      label: overview.displayName,
      unreadCount: overview.unreadCount,
      hasEntered: overview.hasEntered,
    };
  }

  public syncPrivateChatsFromFriendList(friendList: NapcatFriendInfo[]): void {
    for (const friendInfo of friendList) {
      this.ensurePrivateChatState({
        userId: friendInfo.userId,
        friendInfo,
      });
    }
  }

  public ensurePrivateChatState(input: {
    userId: string;
    friendInfo?: NapcatFriendInfo | null;
  }): PrivateChatState {
    const existing = this.privateChatStateByUserId.get(input.userId);
    if (existing) {
      if (input.friendInfo) {
        existing.setFriendInfo(input.friendInfo);
      }
      return existing;
    }

    const privateChatState = new PrivateChatState({
      userId: input.userId,
      unreadLimit: this.recentMessageLimit,
    });
    if (input.friendInfo) {
      privateChatState.setFriendInfo(input.friendInfo);
    }
    this.privateChatStates.push(privateChatState);
    this.privateChatStateByUserId.set(input.userId, privateChatState);
    return privateChatState;
  }

  private async consumeIncomingEventInActiveState(
    event: Event,
  ): Promise<{ shouldTriggerRound: boolean }> {
    const targetStateId = this.resolveEventStateId(event);
    if (!targetStateId) {
      return {
        shouldTriggerRound: false,
      };
    }

    const targetState = this.resolveState(targetStateId);
    if (!targetState) {
      return {
        shouldTriggerRound: false,
      };
    }

    const focusedStateId = this.getFocusedStateId();
    const result = await targetState.handleEvent({
      event,
      isFocused: focusedStateId === targetStateId,
    });

    if (result.messages && result.messages.length > 0) {
      this.pendingIncomingMessages.push(...result.messages);
    }
    if (result.events && result.events.length > 0) {
      this.pendingVisibleEvents.push(...result.events);
    }

    let shouldTriggerRound = result.shouldTriggerRound;

    if (result.stateChanged) {
      const isFocused = focusedStateId === targetStateId;
      const focusedState = this.requireState(focusedStateId);
      const needsReminderRefresh =
        isFocused ||
        (await this.hasDescendantState({
          state: focusedState,
          targetStateId,
        }));
      if (needsReminderRefresh) {
        this.pendingIncomingMessages.push(await this.createStateReminderMessage(focusedStateId));
        shouldTriggerRound = true;
      }

      // Push cross-state notification for non-focused state changes.
      // Skip when focused on portal (portal reminder already shows unread).
      if (!isFocused && focusedStateId !== "portal") {
        const summary = targetState.buildNotificationSummary(event);
        if (summary) {
          this.notificationAccumulator.push({
            stateId: targetStateId,
            displayName: targetState.getDisplayName(),
            summary,
            timestamp: Date.now(),
          });
        }
      }
    }

    return {
      shouldTriggerRound,
    };
  }

  private async renderFocusMessages(
    stateId: RootAgentStateId,
    reason: "initialize" | "enter" | "resume_back",
  ): Promise<LlmMessage[]> {
    const state = this.requireState(stateId);
    return [await this.createStateReminderMessage(stateId), ...(await state.onFocus({ reason }))];
  }

  private async createStateReminderMessage(stateId: RootAgentStateId): Promise<LlmMessage> {
    const state = this.requireState(stateId);
    const children = await state.listChildren();

    return createStateSystemReminderMessage({
      displayName: state.getDisplayName(),
      children: await Promise.all(
        children.map(async child => ({
          id: child.getId(),
          displayName: child.getDisplayName(),
          description: await child.getDescription(),
        })),
      ),
      availableInvokeTools: state.getAvailableInvokeTools(),
    });
  }

  private resolveState(stateId: string): RootAgentState | null {
    if (stateId === "portal") {
      return new PortalState(this);
    }

    if (stateId === "ithome") {
      return this.ithomeNewsService ? new IthomeState(this) : null;
    }

    if (stateId === "terminal") {
      return this.terminalService ? new TerminalStateNode(this) : null;
    }

    const groupId = parseGroupIdFromStateId(stateId);
    if (groupId && this.groupStateById.has(groupId)) {
      return new QqGroupState(this, groupId);
    }

    const userId = parsePrivateUserIdFromStateId(stateId);
    if (userId && this.privateChatStateByUserId.has(userId)) {
      return new QqPrivateState(this, userId);
    }

    return null;
  }

  private requireState(stateId: RootAgentStateId): RootAgentState {
    const state = this.resolveState(stateId);
    if (!state) {
      throw new Error(`Unknown root agent state: ${stateId}`);
    }

    return state;
  }

  private resolveEventStateId(event: Event): RootAgentStateId | null {
    if (event.type === "news_article_ingested") {
      return event.data.sourceKey === "ithome" && this.ithomeNewsService ? "ithome" : null;
    }

    if (event.type === "napcat_group_message") {
      return this.groupStateById.has(event.data.groupId)
        ? createQqGroupStateId(event.data.groupId)
        : null;
    }

    if (event.type === "napcat_friend_list_updated" || event.type === "wake") {
      return null;
    }

    const privateChatState = this.ensurePrivateChatState({
      userId: event.data.userId,
      friendInfo: {
        userId: event.data.userId,
        nickname: event.data.nickname,
        remark: event.data.remark,
      },
    });
    return createQqPrivateStateId(privateChatState.userId);
  }

  private async hasDescendantState(input: {
    state: RootAgentState;
    targetStateId: RootAgentStateId;
  }): Promise<boolean> {
    const children = await input.state.listChildren();
    for (const child of children) {
      if (child.getId() === input.targetStateId) {
        return true;
      }

      if (
        (await this.hasDescendantState({
          state: child,
          targetStateId: input.targetStateId,
        })) === true
      ) {
        return true;
      }
    }

    return false;
  }
}
