import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "../../../../llm/types.js";
import {
  createEnterGroupMessage,
  createExitGroupMessage,
  createPortalSnapshotMessage,
} from "../../context/context-message-factory.js";
import type { Event } from "../../event/event.js";
import type {
  NapcatGatewayService,
  NapcatGroupMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";
import { GroupChatState } from "./group-chat-state.js";

export type RootAgentSessionState =
  | {
      kind: "portal";
    }
  | {
      kind: "group";
      groupId: string;
    };

export type RootAgentPostToolEffects = {
  messages: LlmMessage[];
  events: Event[];
};

export type RootAgentSessionController = {
  getState(): RootAgentSessionState;
  getCurrentGroupId(): string | undefined;
  initializeContext(): Promise<void>;
  consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects>;
  enterGroup(input: { groupId: string }): Promise<Record<string, unknown>>;
  exitGroup(): Promise<Record<string, unknown>>;
};

type RootAgentSessionDeps = {
  context: AgentContext;
  napcatGatewayService: NapcatGatewayService;
  listenGroupIds: string[];
  recentMessageLimit: number;
};

export class RootAgentSession implements RootAgentSessionController {
  private readonly context: AgentContext;
  private readonly napcatGatewayService: NapcatGatewayService;
  private readonly recentMessageLimit: number;
  private readonly groupStates: GroupChatState[];
  private readonly groupStateById: Map<string, GroupChatState>;
  private readonly pendingVisibleEvents: Event[] = [];
  private readonly pendingPostToolMessages: LlmMessage[] = [];
  private readonly pendingPostToolEvents: Event[] = [];
  private portalSnapshotDirty = false;
  private state: RootAgentSessionState = { kind: "portal" };
  private initialized = false;
  private groupInfoLoaded = false;

  public constructor({
    context,
    napcatGatewayService,
    listenGroupIds,
    recentMessageLimit,
  }: RootAgentSessionDeps) {
    this.context = context;
    this.napcatGatewayService = napcatGatewayService;
    this.recentMessageLimit = recentMessageLimit;
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
    return this.state;
  }

  public getCurrentGroupId(): string | undefined {
    return this.state.kind === "group" ? this.state.groupId : undefined;
  }

  public async initializeContext(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.ensureGroupInfosLoaded();
    await this.context.appendMessages([createPortalSnapshotMessage(this.renderPortalGroups())]);
    this.initialized = true;
  }

  public async consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();
    if (event.type !== "napcat_group_message") {
      this.pendingVisibleEvents.push(event);
      return {
        shouldTriggerRound: true,
      };
    }

    const groupState = this.groupStateById.get(event.data.groupId);
    if (!groupState) {
      return {
        shouldTriggerRound: false,
      };
    }

    if (this.state.kind === "group" && this.state.groupId === groupState.groupId) {
      this.pendingVisibleEvents.push(event);
      return {
        shouldTriggerRound: true,
      };
    }

    groupState.pushUnreadMessage(event.data);
    if (this.state.kind === "portal") {
      this.portalSnapshotDirty = true;
      return {
        shouldTriggerRound: true,
      };
    }

    return {
      shouldTriggerRound: false,
    };
  }

  public async flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }> {
    await this.initializeContext();

    const shouldTriggerRound = this.pendingVisibleEvents.length > 0 || this.portalSnapshotDirty;
    if (this.pendingVisibleEvents.length > 0) {
      await this.context.appendEvents(this.pendingVisibleEvents);
      this.pendingVisibleEvents.splice(0, this.pendingVisibleEvents.length);
    }

    if (this.portalSnapshotDirty) {
      await this.ensureGroupInfosLoaded();
      await this.context.appendMessages([createPortalSnapshotMessage(this.renderPortalGroups())]);
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

  public async enterGroup(input: { groupId: string }): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.state.kind !== "portal") {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    const groupState = this.groupStateById.get(input.groupId);
    if (!groupState) {
      return {
        ok: false,
        error: "GROUP_NOT_AVAILABLE",
        groupId: input.groupId,
      };
    }

    const hasEnteredBefore = groupState.hasEntered();
    const hydratedMessages = hasEnteredBefore
      ? groupState.consumeUnreadTail()
      : await this.fetchRecentMessages(input.groupId);
    if (!hasEnteredBefore) {
      groupState.clearUnreadMessages();
    }

    this.state = {
      kind: "group",
      groupId: input.groupId,
    };
    groupState.markEntered();

    this.pendingPostToolMessages.push(
      createEnterGroupMessage({
        groupId: input.groupId,
        source: hasEnteredBefore ? "unread" : "history",
        hydratedCount: hydratedMessages.length,
      }),
    );

    if (hydratedMessages.length > 0) {
      this.pendingPostToolEvents.push(...hydratedMessages.map(createGroupMessageEvent));
    }

    return {
      ok: true,
      groupId: input.groupId,
      source: hasEnteredBefore ? "unread" : "history",
      hydratedCount: hydratedMessages.length,
    };
  }

  public async exitGroup(): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.state.kind !== "group") {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    const previousGroupId = this.state.groupId;
    this.state = { kind: "portal" };

    this.pendingPostToolMessages.push(
      createExitGroupMessage(previousGroupId),
      createPortalSnapshotMessage(this.renderPortalGroups()),
    );

    return {
      ok: true,
      groupId: previousGroupId,
    };
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
}

function createGroupMessageEvent(data: NapcatGroupMessageData): Event {
  return {
    type: "napcat_group_message",
    data,
  };
}
