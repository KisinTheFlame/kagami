import type { RootAgentEffect } from "../../../effect/root-agent-effect.js";
import {
  type RootAgentInvokeToolName,
  type RootAgentState,
  type RootAgentStateHandleEventResult,
  type RootAgentStateHost,
  type RootAgentStateId,
} from "../state.types.js";
import { QqGroupState } from "./qq-group.state.js";
import { QqPrivateState } from "./qq-private.state.js";

export class PortalState implements RootAgentState {
  private readonly host: RootAgentStateHost;

  public constructor(host: RootAgentStateHost) {
    this.host = host;
  }

  public getId(): RootAgentStateId {
    return "portal";
  }

  public getDisplayName(): string {
    return "门户";
  }

  public async getDescription(): Promise<string> {
    return "主入口，可从这里进入群聊、私聊和资讯。";
  }

  public async listChildren(): Promise<RootAgentState[]> {
    await this.host.ensureGroupInfosLoaded();

    const children: RootAgentState[] = this.host.groupStates.map(
      groupState => new QqGroupState(this.host, groupState.groupId),
    );
    children.push(
      ...this.host.privateChatStates.map(
        privateChatState => new QqPrivateState(this.host, privateChatState.userId),
      ),
    );

    return children;
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [];
  }

  public async onFocus(): Promise<readonly RootAgentEffect[]> {
    return [];
  }

  public async onBlur(): Promise<readonly RootAgentEffect[]> {
    return [];
  }

  public async handleEvent(): Promise<RootAgentStateHandleEventResult> {
    return { effects: [] };
  }

  public buildNotificationSummary(): string | null {
    return null;
  }
}
