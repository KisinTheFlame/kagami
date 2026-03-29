import type { AgentContext } from "../../context/agent-context.js";
import type { LlmMessage } from "../../../../llm/types.js";
import {
  createEnterZoneOutMessage,
  createExitZoneOutMessage,
  createPortalSnapshotMessage,
} from "../../context/context-message-factory.js";
import type { Event } from "../../event/event.js";
import type {
  NapcatGatewayService,
  NapcatGroupMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";
import { GroupChatState } from "./group-chat-state.js";

export const ROOT_AGENT_ENTER_TARGET_KINDS = ["qq_group", "zone_out"] as const;
export type RootAgentEnterTargetKind = (typeof ROOT_AGENT_ENTER_TARGET_KINDS)[number];

export const ROOT_AGENT_INVOKE_TOOLS_BY_STATE = {
  portal: [],
  qq_group: ["send_message"],
  zone_out: ["zone_out"],
  waiting: [],
} as const;

export type RootAgentInvokeToolName =
  (typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE)[keyof typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE][number];

export type RootAgentSessionState =
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
      kind: "waiting";
      deadlineAt: Date;
    };

export type RootAgentPostToolEffects = {
  messages: LlmMessage[];
  events: Event[];
};

export type RootAgentSessionController = {
  getState(): RootAgentSessionState;
  getCurrentGroupId(): string | undefined;
  getAvailableInvokeTools(): RootAgentInvokeToolName[];
  initializeContext(): Promise<void>;
  consumeIncomingEvent(event: Event): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingIncomingEffects(): Promise<{ shouldTriggerRound: boolean }>;
  flushPendingPostToolEffects(): Promise<RootAgentPostToolEffects>;
  enter(input: { kind: RootAgentEnterTargetKind; id?: string }): Promise<Record<string, unknown>>;
  backToPortal(): Promise<Record<string, unknown>>;
  wait(input: { deadlineAt: Date }): Promise<Record<string, unknown>>;
  finishWaitingIfExpired(now: Date): Promise<{ shouldTriggerRound: boolean }>;
};

type RootAgentSessionDeps = {
  context: AgentContext;
  napcatGatewayService: NapcatGatewayService;
  listenGroupIds: string[];
  recentMessageLimit: number;
};

type EnterHandler = (input: { id?: string }) => Promise<Record<string, unknown>>;

export class RootAgentSession implements RootAgentSessionController {
  private readonly context: AgentContext;
  private readonly napcatGatewayService: NapcatGatewayService;
  private readonly recentMessageLimit: number;
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
    this.enterHandlers = new Map<RootAgentEnterTargetKind, EnterHandler>([
      ["qq_group", async input => await this.enterQqGroup(input)],
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

    if (this.state.kind === "qq_group" && this.state.groupId === groupState.groupId) {
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

    if (this.state.kind === "waiting") {
      this.state = { kind: "portal" };
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

      this.pendingPostToolMessages.push(createPortalSnapshotMessage(this.renderPortalGroups()));

      return {
        ok: true,
        kind: "qq_group",
        id: previousGroupId,
      };
    }

    this.state = { kind: "portal" };
    this.pendingPostToolMessages.push(
      createExitZoneOutMessage(),
      createPortalSnapshotMessage(this.renderPortalGroups()),
    );

    return {
      ok: true,
      kind: "zone_out",
    };
  }

  public async wait(input: { deadlineAt: Date }): Promise<Record<string, unknown>> {
    await this.initializeContext();

    if (this.state.kind !== "portal") {
      return {
        ok: false,
        error: "STATE_TRANSITION_NOT_ALLOWED",
      };
    }

    this.state = {
      kind: "waiting",
      deadlineAt: new Date(input.deadlineAt),
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

    this.state = { kind: "portal" };
    this.portalSnapshotDirty = true;
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

    if (hydratedMessages.length > 0) {
      this.pendingPostToolEvents.push(...hydratedMessages.map(createGroupMessageEvent));
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
