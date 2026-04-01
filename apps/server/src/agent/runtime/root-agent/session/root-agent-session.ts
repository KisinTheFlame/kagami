import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "../../../../llm/types.js";
import {
  createIthomeArticleDetailMessage,
  createIthomeArticleListMessage,
  createMergedGroupMessagesMessage,
  createEnterZoneOutMessage,
  createExitZoneOutMessage,
  createPortalSnapshotMessage,
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
  PersistedRootAgentActiveSessionState,
  PersistedRootAgentSessionSnapshot,
  PersistedRootAgentSessionState,
} from "../persistence/root-agent-runtime-snapshot.js";

export const ROOT_AGENT_ENTER_TARGET_KINDS = ["qq_group", "zone_out", "ithome"] as const;
export type RootAgentEnterTargetKind = (typeof ROOT_AGENT_ENTER_TARGET_KINDS)[number];

export const ROOT_AGENT_INVOKE_TOOLS_BY_STATE = {
  portal: [],
  qq_group: ["send_message"],
  ithome: ["open_ithome_article"],
  zone_out: ["zone_out"],
  waiting: [],
} as const;

export type RootAgentInvokeToolName =
  (typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE)[keyof typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE][number];

export type RootAgentSessionState =
  | RootAgentActiveSessionState
  | {
      kind: "waiting";
      deadlineAt: Date;
      resumeState: RootAgentActiveSessionState;
    };

export type RootAgentActiveSessionState =
  | {
      kind: "portal";
    }
  | {
      kind: "qq_group";
      groupId: string;
    }
  | {
      kind: "zone_out";
    }
  | {
      kind: "ithome";
    };

export type RootAgentPostToolEffects = {
  messages: LlmMessage[];
  events: Event[];
};

export type RootAgentSessionDashboardGroup = {
  groupId: string;
  groupName?: string;
  unreadCount: number;
  hasEntered: boolean;
};

export type RootAgentSessionDashboardSnapshot = {
  state: RootAgentSessionState;
  currentGroupId: string | null;
  waitingDeadlineAt: Date | null;
  waitingResumeTarget: RootAgentActiveSessionState | null;
  availableInvokeTools: RootAgentInvokeToolName[];
  groups: RootAgentSessionDashboardGroup[];
};

export type RootAgentSessionController = {
  getState(): RootAgentSessionState;
  getCurrentGroupId(): string | undefined;
  getAvailableInvokeTools(): RootAgentInvokeToolName[];
  getDashboardSnapshot(): RootAgentSessionDashboardSnapshot;
  exportPersistedSnapshot(): PersistedRootAgentSessionSnapshot;
  restorePersistedSnapshot(snapshot: PersistedRootAgentSessionSnapshot): void;
  reset(): void;
  initializeContext(): Promise<void>;
  consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects>;
  enter(input: { kind: RootAgentEnterTargetKind; id?: string }): Promise<Record<string, unknown>>;
  openIthomeArticle(input: { articleId: number }): Promise<Record<string, unknown>>;
  backToPortal(): Promise<Record<string, unknown>>;
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

type EnterHandler = (input: { id?: string }) => Promise<Record<string, unknown>>;

type PortalFeedState = {
  kind: "ithome";
  label: string;
  unreadCount: number;
  hasEntered: boolean;
};

export class RootAgentSession implements RootAgentSessionController {
  private readonly context: AgentContext;
  private readonly napcatGatewayService: NapcatGatewayService;
  private readonly recentMessageLimit: number;
  private readonly ithomeNewsService: Pick<
    IthomeNewsService,
    "getFeedOverview" | "enterFeed" | "openArticle"
  > | null;
  private readonly groupStates: GroupChatState[];
  private readonly groupStateById: Map<string, GroupChatState>;
  private readonly pendingVisibleEvents: Event[] = [];
  private readonly pendingIncomingMessages: LlmMessage[] = [];
  private readonly pendingPostToolMessages: LlmMessage[] = [];
  private readonly pendingPostToolEvents: Event[] = [];
  private readonly enterHandlers: Map<RootAgentEnterTargetKind, EnterHandler>;
  private portalSnapshotDirty = false;
  private state: RootAgentSessionState = { kind: "portal" };
  private initialized = false;
  private groupInfoLoaded = false;
  private ithomeFeedState: PortalFeedState | null = null;

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
    this.enterHandlers = new Map<RootAgentEnterTargetKind, EnterHandler>([
      ["qq_group", async input => await this.enterQqGroup(input)],
      ["ithome", async () => await this.enterIthome()],
      ["zone_out", async () => await this.enterZoneOut()],
    ]);
  }

  public getState(): RootAgentSessionState {
    return this.state;
  }

  public getCurrentGroupId(): string | undefined {
    return this.state.kind === "qq_group" ? this.state.groupId : undefined;
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [...ROOT_AGENT_INVOKE_TOOLS_BY_STATE[this.state.kind]];
  }

  public getDashboardSnapshot(): RootAgentSessionDashboardSnapshot {
    return {
      state: cloneSessionState(this.state),
      currentGroupId: this.getCurrentGroupId() ?? null,
      waitingDeadlineAt: this.state.kind === "waiting" ? new Date(this.state.deadlineAt) : null,
      waitingResumeTarget:
        this.state.kind === "waiting" ? cloneActiveSessionState(this.state.resumeState) : null,
      availableInvokeTools: this.getAvailableInvokeTools(),
      groups: this.renderPortalGroups(),
    };
  }

  public exportPersistedSnapshot(): PersistedRootAgentSessionSnapshot {
    return {
      state: cloneSessionState(this.state),
      groups: this.groupStates.map(groupState => ({
        groupId: groupState.groupId,
        groupInfo: groupState.getGroupInfo(),
        unreadMessages: groupState.getUnreadMessages(),
        hasEntered: groupState.hasEntered(),
      })),
    };
  }

  public restorePersistedSnapshot(snapshot: PersistedRootAgentSessionSnapshot): void {
    for (const groupState of this.groupStates) {
      groupState.restoreSnapshot({
        groupInfo: null,
        unreadMessages: [],
        hasEntered: false,
      });
    }

    for (const persistedGroupState of snapshot.groups) {
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
    this.portalSnapshotDirty = false;
    this.groupInfoLoaded = true;
    this.initialized = true;
    this.state = normalizeRestoredSessionState(snapshot.state, this.groupStateById);
  }

  public reset(): void {
    for (const groupState of this.groupStates) {
      groupState.reset();
    }

    this.pendingVisibleEvents.splice(0, this.pendingVisibleEvents.length);
    this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    this.pendingPostToolMessages.splice(0, this.pendingPostToolMessages.length);
    this.pendingPostToolEvents.splice(0, this.pendingPostToolEvents.length);
    this.portalSnapshotDirty = false;
    this.groupInfoLoaded = false;
    this.ithomeFeedState = null;
    this.initialized = false;
    this.state = { kind: "portal" };
  }

  public async initializeContext(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.ensureGroupInfosLoaded();
    await this.ensureIthomeFeedStateLoaded();
    await this.context.appendMessages([
      createPortalSnapshotMessage(this.renderPortalGroups(), this.renderPortalFeeds()),
    ]);
    this.initialized = true;
  }

  public async consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    if (this.state.kind === "waiting") {
      return await this.consumeIncomingEventWhileWaiting(event);
    }

    return await this.consumeIncomingEventInActiveState(this.state, event);
  }

  public async flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    const shouldTriggerRound =
      this.pendingIncomingMessages.length > 0 ||
      this.pendingVisibleEvents.length > 0 ||
      this.portalSnapshotDirty;
    if (this.pendingIncomingMessages.length > 0) {
      await this.context.appendMessages(this.pendingIncomingMessages);
      this.pendingIncomingMessages.splice(0, this.pendingIncomingMessages.length);
    }

    if (this.pendingVisibleEvents.length > 0) {
      await this.context.appendEvents(this.pendingVisibleEvents);
      this.pendingVisibleEvents.splice(0, this.pendingVisibleEvents.length);
    }

    if (this.portalSnapshotDirty) {
      await this.ensureGroupInfosLoaded();
      await this.ensureIthomeFeedStateLoaded();
      await this.context.appendMessages([
        createPortalSnapshotMessage(this.renderPortalGroups(), this.renderPortalFeeds()),
      ]);
      this.portalSnapshotDirty = false;
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

  public async enter(input: {
    kind: RootAgentEnterTargetKind;
    id?: string;
  }): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.state.kind !== "portal") {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    const enterHandler = this.enterHandlers.get(input.kind);
    if (!enterHandler) {
      return {
        ok: false,
        error: "ENTER_TARGET_NOT_SUPPORTED",
        kind: input.kind,
      };
    }

    return await enterHandler({
      id: input.id,
    });
  }

  public async openIthomeArticle(input: { articleId: number }): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.state.kind !== "ithome") {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    if (!this.ithomeNewsService) {
      return {
        ok: false,
        error: "ENTER_TARGET_NOT_AVAILABLE",
        kind: "ithome",
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

  public async backToPortal(): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.state.kind === "portal" || this.state.kind === "waiting") {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    if (this.state.kind === "qq_group") {
      const previousGroupId = this.state.groupId;
      this.state = { kind: "portal" };
      await this.ensureIthomeFeedStateLoaded();

      this.pendingPostToolMessages.push(
        createPortalSnapshotMessage(this.renderPortalGroups(), this.renderPortalFeeds()),
      );

      return {
        ok: true,
        kind: "qq_group",
        id: previousGroupId,
      };
    }

    if (this.state.kind === "ithome") {
      this.state = { kind: "portal" };
      await this.ensureIthomeFeedStateLoaded();
      this.pendingPostToolMessages.push(
        createPortalSnapshotMessage(this.renderPortalGroups(), this.renderPortalFeeds()),
      );

      return {
        ok: true,
        kind: "ithome",
      };
    }

    this.state = { kind: "portal" };
    await this.ensureIthomeFeedStateLoaded();
    this.pendingPostToolMessages.push(
      createExitZoneOutMessage(),
      createPortalSnapshotMessage(this.renderPortalGroups(), this.renderPortalFeeds()),
    );

    return {
      ok: true,
      kind: "zone_out",
    };
  }

  public async wait(input: { deadlineAt: Date }): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.state.kind === "waiting") {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    this.state = {
      kind: "waiting",
      deadlineAt: new Date(input.deadlineAt),
      resumeState: cloneActiveSessionState(this.state),
    };

    return {
      ok: true,
      deadlineAt: input.deadlineAt.toISOString(),
    };
  }

  public async finishWaitingIfExpired(now: Date): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    if (this.state.kind !== "waiting" || now.getTime() < this.state.deadlineAt.getTime()) {
      return {
        shouldTriggerRound: false,
      };
    }

    const resumedState = this.exitWaiting();
    await this.queueWaitResumeMessage({
      reason: "timeout",
      resumedState,
    });
    if (resumedState.kind === "portal") {
      this.portalSnapshotDirty = true;
    }

    return {
      shouldTriggerRound: true,
    };
  }

  private async enterQqGroup(input: { id?: string }): Promise<Record<string, unknown>> {
    const groupId = input.id?.trim();
    if (!groupId) {
      return {
        ok: false,
        error: "ENTER_TARGET_ID_REQUIRED",
        kind: "qq_group",
      };
    }

    const groupState = this.groupStateById.get(groupId);
    if (!groupState) {
      return {
        ok: false,
        error: "ENTER_TARGET_NOT_AVAILABLE",
        kind: "qq_group",
        id: groupId,
      };
    }

    const hasEnteredBefore = groupState.hasEntered();
    const hydratedMessages = hasEnteredBefore
      ? groupState.consumeUnreadTail()
      : await this.fetchRecentMessages(groupId);
    if (!hasEnteredBefore) {
      groupState.clearUnreadMessages();
    }

    this.state = {
      kind: "qq_group",
      groupId,
    };
    groupState.markEntered();

    const hydratedMessage = createMergedGroupMessagesMessage(hydratedMessages);
    if (hydratedMessage) {
      this.pendingPostToolMessages.push(hydratedMessage);
    }

    return {
      ok: true,
      kind: "qq_group",
      id: groupId,
      source: hasEnteredBefore ? "unread" : "history",
      hydratedCount: hydratedMessages.length,
    };
  }

  private async enterZoneOut(): Promise<Record<string, unknown>> {
    this.state = {
      kind: "zone_out",
    };
    this.pendingPostToolMessages.push(createEnterZoneOutMessage());
    return {
      ok: true,
      kind: "zone_out",
    };
  }

  private async enterIthome(): Promise<Record<string, unknown>> {
    if (!this.ithomeNewsService) {
      return {
        ok: false,
        error: "ENTER_TARGET_NOT_AVAILABLE",
        kind: "ithome",
      };
    }

    const result = await this.ithomeNewsService.enterFeed();
    this.state = {
      kind: "ithome",
    };
    this.ithomeFeedState = {
      kind: "ithome",
      label: result.displayName,
      unreadCount: 0,
      hasEntered: true,
    };
    this.pendingPostToolMessages.push(
      createIthomeArticleListMessage({
        displayName: result.displayName,
        mode: result.mode,
        hiddenNewCount: result.hiddenNewCount,
        articles: result.articles,
      }),
    );

    return {
      ok: true,
      kind: "ithome",
      source: result.mode,
      articleCount: result.articles.length,
      hiddenNewCount: result.hiddenNewCount,
    };
  }

  private async consumeIncomingEventWhileWaiting(
    event: Event,
  ): Promise<{ shouldTriggerRound: boolean }> {
    const resumedState = this.exitWaiting();
    await this.queueWaitResumeMessage({
      reason: "event",
      resumedState,
      event,
    });
    await this.consumeIncomingEventInActiveState(resumedState, event);

    return {
      shouldTriggerRound: true,
    };
  }

  private async consumeIncomingEventInActiveState(
    state: RootAgentActiveSessionState,
    event: Event,
  ): Promise<{ shouldTriggerRound: boolean }> {
    if (event.type === "news_article_ingested") {
      return await this.consumeNewsArticleIngestedEventInActiveState(state, event);
    }

    return this.consumeGroupMessageEventInActiveState(state, event);
  }

  private consumeGroupMessageEventInActiveState(
    state: RootAgentActiveSessionState,
    event: Extract<Event, { type: "napcat_group_message" }>,
  ): { shouldTriggerRound: boolean } {
    const groupState = this.groupStateById.get(event.data.groupId);
    if (!groupState) {
      return {
        shouldTriggerRound: false,
      };
    }

    if (state.kind === "qq_group" && state.groupId === groupState.groupId) {
      this.pendingVisibleEvents.push(event);
      return {
        shouldTriggerRound: true,
      };
    }

    groupState.pushUnreadMessage(event.data);
    if (state.kind === "portal") {
      this.portalSnapshotDirty = true;
      return {
        shouldTriggerRound: true,
      };
    }

    return {
      shouldTriggerRound: false,
    };
  }

  private async consumeNewsArticleIngestedEventInActiveState(
    state: RootAgentActiveSessionState,
    event: Extract<Event, { type: "news_article_ingested" }>,
  ): Promise<{ shouldTriggerRound: boolean }> {
    await this.ensureIthomeFeedStateLoaded();
    if (!this.ithomeFeedState || event.data.sourceKey !== this.ithomeFeedState.kind) {
      return {
        shouldTriggerRound: false,
      };
    }

    this.ithomeFeedState.unreadCount += 1;
    if (state.kind === "portal") {
      this.pendingVisibleEvents.push(event);
      this.portalSnapshotDirty = true;
      return {
        shouldTriggerRound: true,
      };
    }

    return {
      shouldTriggerRound: false,
    };
  }

  private exitWaiting(): RootAgentActiveSessionState {
    if (this.state.kind !== "waiting") {
      return cloneActiveSessionState(this.state);
    }

    const resumedState = cloneActiveSessionState(this.state.resumeState);
    this.state = resumedState;
    return resumedState;
  }

  private async queueWaitResumeMessage(input: {
    reason: "timeout" | "event";
    resumedState: RootAgentActiveSessionState;
    event?: Event;
  }): Promise<void> {
    const resumedStateLabel = await this.describeActiveState(input.resumedState);
    const eventSummary = input.event ? await this.describeWakeEvent(input.event) : undefined;
    this.pendingIncomingMessages.push(
      createWaitResumeMessage({
        reason: input.reason,
        resumedStateLabel,
        ...(eventSummary ? { eventSummary } : {}),
      }),
    );
  }

  private async describeActiveState(state: RootAgentActiveSessionState): Promise<string> {
    if (state.kind === "portal") {
      return "门户状态";
    }

    if (state.kind === "zone_out") {
      return "神游状态";
    }

    if (state.kind === "ithome") {
      await this.ensureIthomeFeedStateLoaded();
      return this.ithomeFeedState?.label ?? "IT 之家状态";
    }

    await this.ensureGroupInfosLoaded();
    const groupName = this.groupStateById.get(state.groupId)?.getGroupName();
    return groupName ? `QQ 群 ${groupName}（${state.groupId}）` : `QQ 群 ${state.groupId}`;
  }

  private async describeWakeEvent(event: Event): Promise<string> {
    if (event.type === "news_article_ingested") {
      await this.ensureIthomeFeedStateLoaded();
      const feedLabel = this.ithomeFeedState?.label ?? "IT 之家";
      return `${feedLabel} 有新文章《${event.data.title}》`;
    }

    await this.ensureGroupInfosLoaded();
    const groupName = this.groupStateById.get(event.data.groupId)?.getGroupName();
    return groupName
      ? `QQ 群 ${groupName}（${event.data.groupId}）收到了新消息`
      : `QQ 群 ${event.data.groupId} 收到了新消息`;
  }

  private async fetchRecentMessages(groupId: string): Promise<NapcatGroupMessageData[]> {
    if (this.recentMessageLimit === 0) {
      return [];
    }

    return await this.napcatGatewayService.getRecentGroupMessages({
      groupId,
      count: this.recentMessageLimit,
    });
  }

  private async ensureGroupInfosLoaded(): Promise<void> {
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
          // Fallback to groupId-only portal rendering when group info is unavailable.
        }
      }),
    );
    this.groupInfoLoaded = true;
  }

  private async ensureIthomeFeedStateLoaded(): Promise<void> {
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

  private renderPortalGroups(): Array<{
    groupId: string;
    groupName?: string;
    unreadCount: number;
    hasEntered: boolean;
  }> {
    return this.groupStates.map(groupState => {
      const groupName = groupState.getGroupName();

      return {
        groupId: groupState.groupId,
        ...(groupName ? { groupName } : {}),
        unreadCount: groupState.getUnreadCount(),
        hasEntered: groupState.hasEntered(),
      };
    });
  }

  private renderPortalFeeds(): PortalFeedState[] {
    return this.ithomeFeedState ? [this.ithomeFeedState] : [];
  }
}

function cloneActiveSessionState(state: RootAgentActiveSessionState): RootAgentActiveSessionState {
  return { ...state };
}

function cloneSessionState(state: RootAgentSessionState): RootAgentSessionState {
  if (state.kind !== "waiting") {
    return cloneActiveSessionState(state);
  }

  return {
    kind: "waiting",
    deadlineAt: new Date(state.deadlineAt),
    resumeState: cloneActiveSessionState(state.resumeState),
  };
}

function normalizeActiveSessionState(
  state: PersistedRootAgentActiveSessionState,
  groupStateById: Map<string, GroupChatState>,
): RootAgentActiveSessionState {
  if (state.kind === "qq_group" && !groupStateById.has(state.groupId)) {
    return {
      kind: "portal",
    };
  }

  return cloneActiveSessionState(state);
}

function normalizeRestoredSessionState(
  state: PersistedRootAgentSessionState,
  groupStateById: Map<string, GroupChatState>,
): RootAgentSessionState {
  if (state.kind !== "waiting") {
    return normalizeActiveSessionState(state, groupStateById);
  }

  return {
    kind: "waiting",
    deadlineAt: new Date(state.deadlineAt),
    resumeState: normalizeActiveSessionState(state.resumeState, groupStateById),
  };
}
