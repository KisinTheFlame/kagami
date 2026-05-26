import type {
  NapcatFriendInfo,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";
import type { RootAgentEffect } from "../../effect/root-agent-effect.js";
import type { Event } from "../../event/event.js";
import type { GroupChatState } from "./group-chat-state.js";
import type { PrivateChatState } from "./private-chat-state.js";

export const ROOT_AGENT_STATIC_STATE_IDS = ["portal"] as const;
export type RootAgentStaticStateId = (typeof ROOT_AGENT_STATIC_STATE_IDS)[number];
export type RootAgentStateId =
  | RootAgentStaticStateId
  | `qq_group:${string}`
  | `qq_private:${string}`;

export const ROOT_AGENT_INVOKE_TOOLS_BY_STATE = {
  portal: [],
  qq_group: ["send_message"],
  qq_private: ["send_message"],
} as const;

export type RootAgentInvokeToolName =
  (typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE)[keyof typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE][number];

export type FocusReason = "initialize" | "enter" | "resume_back";
export type BlurReason = "enter_child" | "back";

/**
 * state.handleEvent 的返回。
 *
 * - `effects`：要应用到上下文的 Effect[]（通常是 append_message）。session 在
 *   合适的时机走 Interpreter 应用。
 * - `stateChanged`：可选信号——通知 session "我内部私有状态变了"（比如 unread
 *   计数 ++），session 据此决定要不要刷 reminder、聚合通知。
 *
 * 设计依据：[docs/effect-model.md](docs/effect-model.md) 阶段 4。
 */
export type RootAgentStateHandleEventResult = {
  effects: readonly RootAgentEffect[];
  stateChanged?: boolean;
};

export interface RootAgentState {
  getId(): RootAgentStateId;
  getDisplayName(): string;
  getDescription(): Promise<string>;
  listChildren(): Promise<RootAgentState[]>;
  getAvailableInvokeTools(): RootAgentInvokeToolName[];
  /** 焦点切到本 state 时调用。返 Effect[]，由 session 走 Interpreter 应用。 */
  onFocus(input: { reason: FocusReason }): Promise<readonly RootAgentEffect[]>;
  /** 焦点离开本 state 时调用。 */
  onBlur(input: { reason: BlurReason }): Promise<readonly RootAgentEffect[]>;
  handleEvent(input: {
    event: Event;
    isFocused: boolean;
  }): Promise<RootAgentStateHandleEventResult>;
  buildNotificationSummary(event: Event): string | null;
}

/**
 * 6 个 state 子类需要回头读取 / 修改的 session 内部状态，统一通过这个接口暴露。
 * 把它当成 state 子类的"依赖契约"，避免 state 文件反向 import 整个 RootAgentSession 类导致循环依赖。
 */
export interface RootAgentStateHost {
  readonly groupStates: readonly GroupChatState[];
  readonly groupStateById: ReadonlyMap<string, GroupChatState>;
  readonly privateChatStates: readonly PrivateChatState[];
  readonly privateChatStateByUserId: ReadonlyMap<string, PrivateChatState>;
  ensureGroupInfosLoaded(): Promise<void>;
  fetchRecentMessages(groupId: string): Promise<NapcatGroupMessageData[]>;
  fetchRecentPrivateMessages(userId: string): Promise<NapcatPrivateMessageData[]>;
  ensurePrivateChatState(input: {
    userId: string;
    friendInfo?: NapcatFriendInfo | null;
  }): PrivateChatState;
}
