import type { LlmMessage } from "../../../../llm/types.js";
import type {
  NapcatFriendInfo,
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../../napcat/service/napcat-gateway.service.js";
import type { IthomeNewsService } from "../../../../news/application/ithome-news.service.js";
import type { TerminalService } from "../../../capabilities/terminal/application/terminal.service.js";
import type { Event } from "../../event/event.js";
import type { GroupChatState } from "./group-chat-state.js";
import type { PrivateChatState } from "./private-chat-state.js";
import type { PersistedRootAgentIthomeFeedState } from "../persistence/root-agent-runtime-snapshot.js";

export const ROOT_AGENT_STATIC_STATE_IDS = ["portal", "ithome", "zone_out", "terminal"] as const;
export type RootAgentStaticStateId = (typeof ROOT_AGENT_STATIC_STATE_IDS)[number];
export type RootAgentStateId =
  | RootAgentStaticStateId
  | `qq_group:${string}`
  | `qq_private:${string}`;

export const ROOT_AGENT_INVOKE_TOOLS_BY_STATE = {
  portal: [],
  qq_group: ["send_message"],
  qq_private: ["send_message"],
  ithome: ["open_ithome_article"],
  zone_out: ["zone_out"],
  terminal: ["bash", "read_bash_output"],
} as const;

export type RootAgentInvokeToolName =
  (typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE)[keyof typeof ROOT_AGENT_INVOKE_TOOLS_BY_STATE][number];

export type FocusReason = "initialize" | "enter" | "resume_back";
export type BlurReason = "enter_child" | "back";

export type RootAgentStateHandleEventResult = {
  shouldTriggerRound: boolean;
  messages?: LlmMessage[];
  events?: Event[];
  stateChanged?: boolean;
};

export interface RootAgentState {
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
  readonly ithomeNewsService: Pick<
    IthomeNewsService,
    "getFeedOverview" | "enterFeed" | "openArticle"
  > | null;
  readonly terminalService: Pick<TerminalService, "getCwd"> | null;
  ithomeFeedState: PersistedRootAgentIthomeFeedState | null;
  ensureGroupInfosLoaded(): Promise<void>;
  ensureIthomeFeedStateLoaded(): Promise<void>;
  fetchRecentMessages(groupId: string): Promise<NapcatGroupMessageData[]>;
  fetchRecentPrivateMessages(userId: string): Promise<NapcatPrivateMessageData[]>;
  ensurePrivateChatState(input: {
    userId: string;
    friendInfo?: NapcatFriendInfo | null;
  }): PrivateChatState;
}
