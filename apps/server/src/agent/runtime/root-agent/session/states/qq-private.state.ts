import type { LlmMessage } from "../../../../../llm/types.js";
import { createMergedPrivateMessagesMessage } from "../../../context/context-message-factory.js";
import type { Event } from "../../../event/event.js";
import { createQqPrivateStateId } from "../state-id.js";
import {
  ROOT_AGENT_INVOKE_TOOLS_BY_STATE,
  type FocusReason,
  type RootAgentInvokeToolName,
  type RootAgentState,
  type RootAgentStateHandleEventResult,
  type RootAgentStateHost,
  type RootAgentStateId,
} from "../state.types.js";

export class QqPrivateState implements RootAgentState {
  private readonly host: RootAgentStateHost;
  private readonly userId: string;

  public constructor(host: RootAgentStateHost, userId: string) {
    this.host = host;
    this.userId = userId;
  }

  public getId(): RootAgentStateId {
    return createQqPrivateStateId(this.userId);
  }

  public getDisplayName(): string {
    const privateChatState = this.host.privateChatStateByUserId.get(this.userId);
    const displayName = privateChatState?.getDisplayName() ?? this.userId;
    return `QQ 私聊 ${displayName} (${this.userId})`;
  }

  public async getDescription(): Promise<string> {
    const privateChatState = this.host.privateChatStateByUserId.get(this.userId);
    if (!privateChatState) {
      return "私聊状态不可用。";
    }

    if (privateChatState.getUnreadCount() > 0) {
      return `未读 ${privateChatState.getUnreadCount()} 条消息。`;
    }

    if (!privateChatState.hasEntered()) {
      return "尚未查看，可进去看看最近消息。";
    }

    return "未读 0 条消息。";
  }

  public async listChildren(): Promise<RootAgentState[]> {
    return [];
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [...ROOT_AGENT_INVOKE_TOOLS_BY_STATE.qq_private];
  }

  public async onFocus(input: { reason: FocusReason }): Promise<LlmMessage[]> {
    void input;
    const privateChatState = this.host.privateChatStateByUserId.get(this.userId);
    if (!privateChatState) {
      return [];
    }

    const hasEnteredBefore = privateChatState.hasEntered();
    const hydratedMessages = hasEnteredBefore
      ? privateChatState.consumeUnreadTail()
      : await this.host.fetchRecentPrivateMessages(this.userId);
    if (!hasEnteredBefore) {
      privateChatState.clearUnreadMessages();
    }

    privateChatState.markEntered();
    const hydratedMessage = createMergedPrivateMessagesMessage(hydratedMessages);
    return hydratedMessage ? [hydratedMessage] : [];
  }

  public async onBlur(): Promise<LlmMessage[]> {
    return [];
  }

  public async handleEvent(input: {
    event: Event;
    isFocused: boolean;
  }): Promise<RootAgentStateHandleEventResult> {
    if (input.event.type !== "napcat_private_message" || input.event.data.userId !== this.userId) {
      return {
        shouldTriggerRound: false,
      };
    }

    const privateChatState = this.host.ensurePrivateChatState({
      userId: input.event.data.userId,
      friendInfo: {
        userId: input.event.data.userId,
        nickname: input.event.data.nickname,
        remark: input.event.data.remark,
      },
    });

    if (input.isFocused) {
      return {
        shouldTriggerRound: true,
        events: [input.event],
      };
    }

    privateChatState.pushUnreadMessage(input.event.data);
    return {
      shouldTriggerRound: false,
      stateChanged: true,
    };
  }

  public buildNotificationSummary(event: Event): string | null {
    if (event.type !== "napcat_private_message") {
      return null;
    }
    const unreadCount = this.host.privateChatStateByUserId.get(this.userId)?.getUnreadCount();
    return `未读 ${unreadCount ?? 0} 条消息。`;
  }
}
