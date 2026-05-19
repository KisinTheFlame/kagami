import type { LlmMessage } from "../../../../../llm/types.js";
import {
  type RootAgentInvokeToolName,
  type RootAgentState,
  type RootAgentStateHandleEventResult,
  type RootAgentStateHost,
  type RootAgentStateId,
} from "../state.types.js";
import { IthomeState } from "./ithome.state.js";
import { QqGroupState } from "./qq-group.state.js";
import { QqPrivateState } from "./qq-private.state.js";
import { TerminalStateNode } from "./terminal.state.js";

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
    await this.host.ensureIthomeFeedStateLoaded();

    const children: RootAgentState[] = this.host.groupStates.map(
      groupState => new QqGroupState(this.host, groupState.groupId),
    );
    children.push(
      ...this.host.privateChatStates.map(
        privateChatState => new QqPrivateState(this.host, privateChatState.userId),
      ),
    );

    if (this.host.ithomeNewsService) {
      children.push(new IthomeState(this.host));
    }
    if (this.host.terminalService) {
      children.push(new TerminalStateNode(this.host));
    }

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

  public buildNotificationSummary(): string | null {
    return null;
  }
}
