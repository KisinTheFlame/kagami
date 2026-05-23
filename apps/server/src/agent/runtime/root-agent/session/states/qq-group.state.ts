import {
  renderGroupMessagePlainText,
  renderMergedGroupMessagesContent,
} from "../../../context/context-message-factory.js";
import type { RootAgentEffect } from "../../../effect/root-agent-effect.js";
import type { Event } from "../../../event/event.js";
import { createQqGroupStateId } from "../state-id.js";
import {
  ROOT_AGENT_INVOKE_TOOLS_BY_STATE,
  type FocusReason,
  type RootAgentInvokeToolName,
  type RootAgentState,
  type RootAgentStateHandleEventResult,
  type RootAgentStateHost,
  type RootAgentStateId,
} from "../state.types.js";

export class QqGroupState implements RootAgentState {
  private readonly host: RootAgentStateHost;
  private readonly groupId: string;

  public constructor(host: RootAgentStateHost, groupId: string) {
    this.host = host;
    this.groupId = groupId;
  }

  public getId(): RootAgentStateId {
    return createQqGroupStateId(this.groupId);
  }

  public getDisplayName(): string {
    const groupName = this.host.groupStateById.get(this.groupId)?.getGroupName();
    return groupName ? `QQ 群 ${groupName} (${this.groupId})` : `QQ 群 ${this.groupId}`;
  }

  public async getDescription(): Promise<string> {
    const groupState = this.host.groupStateById.get(this.groupId);
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

  public async onFocus(input: { reason: FocusReason }): Promise<readonly RootAgentEffect[]> {
    void input;
    const groupState = this.host.groupStateById.get(this.groupId);
    if (!groupState) {
      return [];
    }

    const hasEnteredBefore = groupState.hasEntered();
    const hydratedMessages = hasEnteredBefore
      ? groupState.consumeUnreadTail()
      : await this.host.fetchRecentMessages(this.groupId);
    if (!hasEnteredBefore) {
      groupState.clearUnreadMessages();
    }

    groupState.markEntered();
    const content = renderMergedGroupMessagesContent(hydratedMessages);
    return content === null ? [] : [{ type: "append_message", content }];
  }

  public async onBlur(): Promise<readonly RootAgentEffect[]> {
    return [];
  }

  public async handleEvent(input: {
    event: Event;
    isFocused: boolean;
  }): Promise<RootAgentStateHandleEventResult> {
    if (input.event.type !== "napcat_group_message" || input.event.data.groupId !== this.groupId) {
      return { effects: [] };
    }

    const groupState = this.host.groupStateById.get(this.groupId);
    if (!groupState) {
      return { effects: [] };
    }

    if (input.isFocused) {
      // 焦点群：消息渲染追加上下文（一个 append_message Effect）。
      return {
        effects: [
          { type: "append_message", content: renderGroupMessagePlainText(input.event.data) },
        ],
      };
    }

    // 非焦点群：累积进 state 私有的 unreadMessages，通知 session "我变了"（让
    // session 决定要不要刷 reminder / 聚合通知）。
    groupState.pushUnreadMessage(input.event.data);
    return {
      effects: [],
      stateChanged: true,
    };
  }

  public buildNotificationSummary(event: Event): string | null {
    if (event.type !== "napcat_group_message") {
      return null;
    }
    const unreadCount = this.host.groupStateById.get(this.groupId)?.getUnreadCount();
    return `未读 ${unreadCount ?? 0} 条消息。`;
  }
}
