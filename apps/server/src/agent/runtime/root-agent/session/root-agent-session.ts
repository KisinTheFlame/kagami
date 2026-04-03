import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "../../../../llm/types.js";
import {
  createIthomeArticleDetailMessage,
  createIthomeArticleListMessage,
  createMergedGroupMessagesMessage,
  createEnterZoneOutMessage,
  createExitZoneOutMessage,
  createStateSystemReminderMessage,
  createWaitResumeMessage,
} from "../../context/context-message-factory.js";
import type { Event } from "../../event/event.js";
import type {
  NapcatGatewayService,
  NapcatGroupMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";
import type { IthomeNewsService } from "../../../../news/application/ithome-news.service.js";
import { GroupChatState } from "./group-chat-state.js";
import type {
  CurrentPersistedRootAgentSessionSnapshot,
  PersistedRootAgentIthomeFeedState,
  PersistedRootAgentSessionSnapshot,
} from "../persistence/root-agent-runtime-snapshot.js";

export const ROOT_AGENT_STATIC_STATE_IDS = ["portal", "ithome", "zone_out"] as const;
export type RootAgentStaticStateId = (typeof ROOT_AGENT_STATIC_STATE_IDS)[number];
export type RootAgentStateId = RootAgentStaticStateId | `qq_group:${string}`;

export const ROOT_AGENT_INVOKE_TOOLS_BY_STATE = {
  portal: [],
  qq_group: ["send_message"],
  ithome: ["open_ithome_article"],
  zone_out: ["zone_out"],
} as const;

export type RootAgentInvokeToolName =
  (typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE)[keyof typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE][number];

export type RootAgentSessionState = {
  focusedStateId: RootAgentStateId;
  stateStack: RootAgentStateId[];
  waiting: {
    deadlineAt: Date;
    resumeStateId: RootAgentStateId;
  } | null;
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
  waiting: {
    active: boolean;
    deadlineAt: Date | null;
    resumeStateId: RootAgentStateId | null;
  };
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
    input: { id: string } | { kind: "qq_group" | "ithome" | "zone_out"; id?: string },
  ): Promise<Record<string, unknown>>;
  openIthomeArticle(input: { articleId: number }): Promise<Record<string, unknown>>;
  back(): Promise<Record<string, unknown>>;
  backToPortal?(): Promise<Record<string, unknown>>;
  wait(input: { deadlineAt: Date }): Promise<Record<string, unknown>>;
  finishWaitingIfExpired(now: Date): Promise<{ shouldTriggerRound: boolean }>;
};

type RootAgentSessionDeps = {
  context: AgentContext;
  napcatGatewayService: NapcatGatewayService;
  listenGroupIds: string[];
  recentMessageLimit: number;
  ithomeNewsService?: Pick<IthomeNewsService, "getFeedOverview" | "enterFeed" | "openArticle">;
};

type PortalFeedState = PersistedRootAgentIthomeFeedState;

type WaitOverlay = {
  deadlineAt: Date;
  resumeStateStack: RootAgentStateId[];
};

type FocusReason = "initialize" | "enter" | "resume_back" | "resume_wait";
type BlurReason = "enter_child" | "back" | "wait";

type RootAgentStateHandleEventResult = {
  shouldTriggerRound: boolean;
  messages?: LlmMessage[];
  events?: Event[];
  stateChanged?: boolean;
};

type RootAgentState = {
  getId(): RootAgentStateId;
  getDisplayName(): string;
  getDescription(): Promise<string>;
  listChildren(): Promise<RootAgentState[]>;
  getAvailableInvokeTools(): RootAgentInvokeToolName[];
  onFocus(input: { reason: FocusReason }): Promise<LlmMessage[]>;
  onBlur(input: { reason: BlurReason }): Promise<LlmMessage[]>;
  handleEvent(input: {
    event: Event;
    isFocused: boolean;
  }): Promise<RootAgentStateHandleEventResult>;
};

export class RootAgentSession implements RootAgentSessionController {
  private readonly context: AgentContext;
  private readonly napcatGatewayService: NapcatGatewayService;
  private readonly recentMessageLimit: number;
  public readonly ithomeNewsService: Pick<
    IthomeNewsService,
    "getFeedOverview" | "enterFeed" | "openArticle"
  > | null;
  public readonly groupStates: GroupChatState[];
  public readonly groupStateById: Map<string, GroupChatState>;
  private readonly pendingVisibleEvents: Event[] = [];
  private readonly pendingIncomingMessages: LlmMessage[] = [];
  private readonly pendingPostToolMessages: LlmMessage[] = [];
  private readonly pendingPostToolEvents: Event[] = [];
  private stateStack: RootAgentStateId[] = ["portal"];
  private waitOverlay: WaitOverlay | null = null;
  private initialized = false;
  private groupInfoLoaded = false;
  public ithomeFeedState: PortalFeedState | null = null;

  public constructor({
    context,
    napcatGatewayService,
    listenGroupIds,
    recentMessageLimit,
    ithomeNewsService,
  }: RootAgentSessionDeps) {
    this.context = context;
    this.napcatGatewayService = napcatGatewayService;
    this.recentMessageLimit = recentMessageLimit;
    this.ithomeNewsService = ithomeNewsService ?? null;
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
      waiting: this.waitOverlay
        ? {
            deadlineAt: new Date(this.waitOverlay.deadlineAt),
            resumeStateId: this.waitOverlay.resumeStateStack.at(-1) ?? "portal",
          }
        : null,
    };
  }

  public getFocusedStateId(): RootAgentStateId {
    return this.stateStack.at(-1) ?? "portal";
  }

  public getCurrentGroupId(): string | undefined {
    if (this.waitOverlay) {
      return undefined;
    }

    const focusedStateId = this.getFocusedStateId();
    return parseGroupIdFromStateId(focusedStateId);
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    if (this.waitOverlay) {
      return [];
    }

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
      waiting: {
        active: this.waitOverlay !== null,
        deadlineAt: this.waitOverlay ? new Date(this.waitOverlay.deadlineAt) : null,
        resumeStateId: this.waitOverlay?.resumeStateStack.at(-1) ?? null,
      },
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
      waitOverlay: this.waitOverlay
        ? {
            deadlineAt: new Date(this.waitOverlay.deadlineAt),
            resumeStateStack: [...this.waitOverlay.resumeStateStack],
          }
        : null,
      groups: this.groupStates.map(groupState => ({
        groupId: groupState.groupId,
        groupInfo: groupState.getGroupInfo(),
        unreadMessages: groupState.getUnreadMessages(),
        hasEntered: groupState.hasEntered(),
      })),
      ithomeFeedState: this.ithomeFeedState ? { ...this.ithomeFeedState } : null,
    };
  }

  public restorePersistedSnapshot(snapshot: PersistedRootAgentSessionSnapshot): void {
    const normalizedSnapshot = normalizePersistedSnapshot(snapshot, this.groupStateById);

    for (const groupState of this.groupStates) {
      groupState.restoreSnapshot({
        groupInfo: null,
        unreadMessages: [],
        hasEntered: false,
      });
    }

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

    this.pendingVisibleEvents.splice(0, this.pendingVisibleEvents.length);
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.pendingPostToolEvents.splice(0, this.pendingPostToolEvents.length);
    this.groupInfoLoaded = normalizedSnapshot.groupInfoLoaded;
    this.ithomeFeedState = normalizedSnapshot.ithomeFeedState;
    this.initialized = true;
    this.stateStack = normalizedSnapshot.stateStack;
    this.waitOverlay = normalizedSnapshot.waitOverlay;
  }

  public reset(): void {
    for (const groupState of this.groupStates) {
      groupState.reset();
    }

    this.pendingVisibleEvents.splice(0, this.pendingVisibleEvents.length);
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.pendingPostToolEvents.splice(0, this.pendingPostToolEvents.length);
    this.groupInfoLoaded = false;
    this.ithomeFeedState = null;
    this.initialized = false;
    this.stateStack = ["portal"];
    this.waitOverlay = null;
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

    if (this.waitOverlay) {
      return await this.consumeIncomingEventWhileWaiting(event);
    }

    return await this.consumeIncomingEventInActiveState(event);
  }

  public async flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

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
    input: { id: string } | { kind: "qq_group" | "ithome" | "zone_out"; id?: string },
  ): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.waitOverlay) {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

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

    if (this.waitOverlay || this.getFocusedStateId() !== "ithome") {
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

    if (this.waitOverlay || this.stateStack.length <= 1) {
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

  public async wait(input: { deadlineAt: Date }): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.waitOverlay) {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    const currentState = this.requireState(this.getFocusedStateId());
    this.pendingPostToolMessages.push(...(await currentState.onBlur({ reason: "wait" })));
    this.waitOverlay = {
      deadlineAt: new Date(input.deadlineAt),
      resumeStateStack: [...this.stateStack],
    };

    return {
      ok: true,
      deadlineAt: input.deadlineAt.toISOString(),
    };
  }

  public async finishWaitingIfExpired(now: Date): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    if (!this.waitOverlay || now.getTime() < this.waitOverlay.deadlineAt.getTime()) {
      return {
        shouldTriggerRound: false,
      };
    }

    const resumedStateId = await this.resumeFromWait({
      reason: "timeout",
    });

    return {
      shouldTriggerRound: resumedStateId !== null,
    };
  }

  private async consumeIncomingEventWhileWaiting(
    event: Event,
  ): Promise<{ shouldTriggerRound: boolean }> {
    await this.resumeFromWait({
      reason: "event",
      event,
    });
    return await this.consumeIncomingEventInActiveState(event);
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
      const focusedState = this.requireState(focusedStateId);
      const needsReminderRefresh =
        focusedStateId === targetStateId ||
        (await this.hasDescendantState({
          state: focusedState,
          targetStateId,
        }));
      if (needsReminderRefresh) {
        this.pendingIncomingMessages.push(await this.createStateReminderMessage(focusedStateId));
        shouldTriggerRound = true;
      }
    }

    return {
      shouldTriggerRound,
    };
  }

  private async resumeFromWait(input: {
    reason: "timeout" | "event";
    event?: Event;
  }): Promise<RootAgentStateId | null> {
    if (!this.waitOverlay) {
      return null;
    }

    const resumedStateId = this.waitOverlay.resumeStateStack.at(-1) ?? "portal";
    this.stateStack = [...this.waitOverlay.resumeStateStack];
    this.waitOverlay = null;

    this.pendingIncomingMessages.push(
      await this.createWaitResumeMessage({
        reason: input.reason,
        resumedStateId,
        event: input.event,
      }),
    );
    this.pendingIncomingMessages.push(
      ...(await this.renderFocusMessages(resumedStateId, "resume_wait")),
    );

    return resumedStateId;
  }

  private async createWaitResumeMessage(input: {
    reason: "timeout" | "event";
    resumedStateId: RootAgentStateId;
    event?: Event;
  }): Promise<LlmMessage> {
    const resumedState = this.requireState(input.resumedStateId);
    const eventSummary = input.event ? await this.describeWakeEvent(input.event) : undefined;
    return createWaitResumeMessage({
      reason: input.reason,
      resumedStateLabel: resumedState.getDisplayName(),
      ...(eventSummary ? { eventSummary } : {}),
    });
  }

  private async describeWakeEvent(event: Event): Promise<string> {
    const targetStateId = this.resolveEventStateId(event);
    if (!targetStateId) {
      return "收到了新的外部事件";
    }

    if (event.type === "news_article_ingested") {
      const feedLabel = this.ithomeFeedState?.label ?? "IT 之家";
      return `${feedLabel} 有新文章《${event.data.title}》`;
    }

    if (event.type === "napcat_group_message") {
      return `${await this.resolveWakeEventGroupLabel(event.data.groupId)} 收到了新消息`;
    }

    const targetState = this.resolveState(targetStateId);
    if (!targetState) {
      return "收到了新的外部事件";
    }

    return `${targetState.getDisplayName()} 收到了新消息`;
  }

  private async resolveWakeEventGroupLabel(groupId: string): Promise<string> {
    const groupState = this.groupStateById.get(groupId);
    const cachedGroupName = groupState?.getGroupName();
    if (cachedGroupName) {
      return `QQ 群 ${cachedGroupName}`;
    }

    try {
      const groupInfo = await this.napcatGatewayService.getGroupInfo({
        groupId,
      });
      groupState?.setGroupInfo(groupInfo);

      const groupName = groupInfo.groupName.trim();
      if (groupName.length > 0) {
        return `QQ 群 ${groupName}`;
      }
    } catch {
      // Fallback to groupId-only rendering when group info is unavailable.
    }

    return `QQ 群 ${groupId}`;
  }

  private async renderFocusMessages(
    stateId: RootAgentStateId,
    reason: FocusReason,
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

    if (stateId === "zone_out") {
      return new ZoneOutState(this);
    }

    const groupId = parseGroupIdFromStateId(stateId);
    if (!groupId || !this.groupStateById.has(groupId)) {
      return null;
    }

    return new QqGroupState(this, groupId);
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

    return this.groupStateById.has(event.data.groupId)
      ? createQqGroupStateId(event.data.groupId)
      : null;
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

  public async fetchRecentMessages(groupId: string): Promise<NapcatGroupMessageData[]> {
    if (this.recentMessageLimit === 0) {
      return [];
    }

    return await this.napcatGatewayService.getRecentGroupMessages({
      groupId,
      count: this.recentMessageLimit,
    });
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
}

class PortalState implements RootAgentState {
  private readonly session: RootAgentSession;

  public constructor(session: RootAgentSession) {
    this.session = session;
  }

  public getId(): RootAgentStateId {
    return "portal";
  }

  public getDisplayName(): string {
    return "门户";
  }

  public async getDescription(): Promise<string> {
    return "主入口，可从这里进入群聊、资讯和神游。";
  }

  public async listChildren(): Promise<RootAgentState[]> {
    await this.session.ensureGroupInfosLoaded();
    await this.session.ensureIthomeFeedStateLoaded();

    const children: RootAgentState[] = this.session.groupStates.map(
      groupState => new QqGroupState(this.session, groupState.groupId),
    );

    if (this.session.ithomeNewsService) {
      children.push(new IthomeState(this.session));
    }
    children.push(new ZoneOutState(this.session));

    return children;
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [];
  }

  public async onFocus(): Promise<LlmMessage[]> {
    return [];
  }

  public async onBlur(): Promise<LlmMessage[]> {
    return [];
  }

  public async handleEvent(): Promise<RootAgentStateHandleEventResult> {
    return {
      shouldTriggerRound: false,
    };
  }
}

class QqGroupState implements RootAgentState {
  private readonly session: RootAgentSession;
  private readonly groupId: string;

  public constructor(session: RootAgentSession, groupId: string) {
    this.session = session;
    this.groupId = groupId;
  }

  public getId(): RootAgentStateId {
    return createQqGroupStateId(this.groupId);
  }

  public getDisplayName(): string {
    const groupName = this.session.groupStateById.get(this.groupId)?.getGroupName();
    return groupName ? `QQ 群 ${groupName} (${this.groupId})` : `QQ 群 ${this.groupId}`;
  }

  public async getDescription(): Promise<string> {
    const groupState = this.session.groupStateById.get(this.groupId);
    if (!groupState) {
      return "群状态不可用。";
    }

    if (groupState.getUnreadCount() > 0) {
      return `未读 ${groupState.getUnreadCount()} 条消息。`;
    }

    if (!groupState.hasEntered()) {
      return "尚未查看，可进去看看最近消息。";
    }

    return "未读 0 条消息。";
  }

  public async listChildren(): Promise<RootAgentState[]> {
    return [];
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [...ROOT_AGENT_INVOKE_TOOLS_BY_STATE.qq_group];
  }

  public async onFocus(input: { reason: FocusReason }): Promise<LlmMessage[]> {
    if (input.reason === "resume_wait") {
      return [];
    }

    const groupState = this.session.groupStateById.get(this.groupId);
    if (!groupState) {
      return [];
    }

    const hasEnteredBefore = groupState.hasEntered();
    const hydratedMessages = hasEnteredBefore
      ? groupState.consumeUnreadTail()
      : await this.session.fetchRecentMessages(this.groupId);
    if (!hasEnteredBefore) {
      groupState.clearUnreadMessages();
    }

    groupState.markEntered();
    const hydratedMessage = createMergedGroupMessagesMessage(hydratedMessages);
    return hydratedMessage ? [hydratedMessage] : [];
  }

  public async onBlur(): Promise<LlmMessage[]> {
    return [];
  }

  public async handleEvent(input: {
    event: Event;
    isFocused: boolean;
  }): Promise<RootAgentStateHandleEventResult> {
    if (input.event.type !== "napcat_group_message" || input.event.data.groupId !== this.groupId) {
      return {
        shouldTriggerRound: false,
      };
    }

    const groupState = this.session.groupStateById.get(this.groupId);
    if (!groupState) {
      return {
        shouldTriggerRound: false,
      };
    }

    if (input.isFocused) {
      return {
        shouldTriggerRound: true,
        events: [input.event],
      };
    }

    groupState.pushUnreadMessage(input.event.data);
    return {
      shouldTriggerRound: false,
      stateChanged: true,
    };
  }
}

class IthomeState implements RootAgentState {
  private readonly session: RootAgentSession;

  public constructor(session: RootAgentSession) {
    this.session = session;
  }

  public getId(): RootAgentStateId {
    return "ithome";
  }

  public getDisplayName(): string {
    return this.session.ithomeFeedState?.label ?? "IT 之家";
  }

  public async getDescription(): Promise<string> {
    await this.session.ensureIthomeFeedStateLoaded();
    if (!this.session.ithomeFeedState) {
      return "资讯空间不可用。";
    }

    if (!this.session.ithomeFeedState.hasEntered) {
      return "尚未查看，可进去看看最近文章。";
    }

    return this.session.ithomeFeedState.unreadCount > 0
      ? `新文章 ${this.session.ithomeFeedState.unreadCount} 篇。`
      : "暂无新文章，可进去看看最近文章。";
  }

  public async listChildren(): Promise<RootAgentState[]> {
    return [];
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [...ROOT_AGENT_INVOKE_TOOLS_BY_STATE.ithome];
  }

  public async onFocus(): Promise<LlmMessage[]> {
    if (!this.session.ithomeNewsService) {
      return [];
    }

    const result = await this.session.ithomeNewsService.enterFeed();
    this.session.ithomeFeedState = {
      kind: "ithome",
      label: result.displayName,
      unreadCount: 0,
      hasEntered: true,
    };

    return [
      createIthomeArticleListMessage({
        displayName: result.displayName,
        mode: result.mode,
        hiddenNewCount: result.hiddenNewCount,
        articles: result.articles,
      }),
    ];
  }

  public async onBlur(): Promise<LlmMessage[]> {
    return [];
  }

  public async handleEvent(input: {
    event: Event;
    isFocused: boolean;
  }): Promise<RootAgentStateHandleEventResult> {
    if (input.event.type !== "news_article_ingested") {
      return {
        shouldTriggerRound: false,
      };
    }

    await this.session.ensureIthomeFeedStateLoaded();
    if (
      !this.session.ithomeFeedState ||
      input.event.data.sourceKey !== this.session.ithomeFeedState.kind
    ) {
      return {
        shouldTriggerRound: false,
      };
    }

    this.session.ithomeFeedState.unreadCount += 1;
    return {
      shouldTriggerRound: false,
      stateChanged: true,
    };
  }
}

class ZoneOutState implements RootAgentState {
  private readonly session: RootAgentSession;

  public constructor(session: RootAgentSession) {
    this.session = session;
  }

  public getId(): RootAgentStateId {
    return "zone_out";
  }

  public getDisplayName(): string {
    return "神游";
  }

  public async getDescription(): Promise<string> {
    return "进入自由思考状态。";
  }

  public async listChildren(): Promise<RootAgentState[]> {
    return [];
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [...ROOT_AGENT_INVOKE_TOOLS_BY_STATE.zone_out];
  }

  public async onFocus(): Promise<LlmMessage[]> {
    return [createEnterZoneOutMessage()];
  }

  public async onBlur(input: { reason: BlurReason }): Promise<LlmMessage[]> {
    return input.reason === "back" ? [createExitZoneOutMessage()] : [];
  }

  public async handleEvent(): Promise<RootAgentStateHandleEventResult> {
    return {
      shouldTriggerRound: false,
    };
  }
}

function createQqGroupStateId(groupId: string): `qq_group:${string}` {
  return `qq_group:${groupId}`;
}

function parseGroupIdFromStateId(stateId: string): string | undefined {
  return stateId.startsWith("qq_group:") ? stateId.slice("qq_group:".length) : undefined;
}

function normalizeEnterInputToStateId(
  input: { id: string } | { kind: "qq_group" | "ithome" | "zone_out"; id?: string },
): string | null {
  if ("kind" in input) {
    if (input.kind === "qq_group") {
      return input.id?.trim() ? createQqGroupStateId(input.id.trim()) : null;
    }

    return input.kind;
  }

  return input.id.trim();
}

function cloneGroupStates(
  groups: CurrentPersistedRootAgentSessionSnapshot["groups"],
): CurrentPersistedRootAgentSessionSnapshot["groups"] {
  return groups.map(group => ({
    groupId: group.groupId,
    groupInfo: group.groupInfo ? structuredClone(group.groupInfo) : null,
    unreadMessages: structuredClone(group.unreadMessages),
    hasEntered: group.hasEntered,
  }));
}

function normalizePersistedSnapshot(
  snapshot: PersistedRootAgentSessionSnapshot,
  groupStateById: Map<string, GroupChatState>,
): {
  stateStack: RootAgentStateId[];
  waitOverlay: WaitOverlay | null;
  groups: CurrentPersistedRootAgentSessionSnapshot["groups"];
  ithomeFeedState: PortalFeedState | null;
  groupInfoLoaded: boolean;
} {
  const normalizedStack = snapshot.stateStack
    .map(stateId => normalizeStateId(stateId, groupStateById))
    .filter((stateId): stateId is RootAgentStateId => stateId !== null);
  const normalizedResumeStateStack =
    snapshot.waitOverlay?.resumeStateStack
      .map(stateId => normalizeStateId(stateId, groupStateById))
      .filter((stateId): stateId is RootAgentStateId => stateId !== null) ?? [];

  return {
    stateStack: normalizedStack.length > 0 ? normalizedStack : ["portal"],
    waitOverlay: snapshot.waitOverlay
      ? {
          deadlineAt: new Date(snapshot.waitOverlay.deadlineAt),
          resumeStateStack:
            normalizedResumeStateStack.length > 0 ? normalizedResumeStateStack : ["portal"],
        }
      : null,
    groups: cloneGroupStates(snapshot.groups),
    ithomeFeedState: snapshot.ithomeFeedState ? { ...snapshot.ithomeFeedState } : null,
    groupInfoLoaded: snapshot.groups.some(group => group.groupInfo !== null),
  };
}

function normalizeStateId(
  stateId: string,
  groupStateById: Map<string, GroupChatState>,
): RootAgentStateId | null {
  if (stateId === "portal" || stateId === "ithome" || stateId === "zone_out") {
    return stateId;
  }

  const groupId = parseGroupIdFromStateId(stateId);
  if (groupId && groupStateById.has(groupId)) {
    return createQqGroupStateId(groupId);
  }

  return null;
}
