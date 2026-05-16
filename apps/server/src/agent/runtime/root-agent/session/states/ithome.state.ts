import type { LlmMessage } from "../../../../../llm/types.js";
import { createIthomeArticleListMessage } from "../../../context/context-message-factory.js";
import type { Event } from "../../../event/event.js";
import {
  ROOT_AGENT_INVOKE_TOOLS_BY_STATE,
  type RootAgentInvokeToolName,
  type RootAgentState,
  type RootAgentStateHandleEventResult,
  type RootAgentStateHost,
  type RootAgentStateId,
} from "../state.types.js";

export class IthomeState implements RootAgentState {
  private readonly host: RootAgentStateHost;

  public constructor(host: RootAgentStateHost) {
    this.host = host;
  }

  public getId(): RootAgentStateId {
    return "ithome";
  }

  public getDisplayName(): string {
    return this.host.ithomeFeedState?.label ?? "IT 之家";
  }

  public async getDescription(): Promise<string> {
    await this.host.ensureIthomeFeedStateLoaded();
    if (!this.host.ithomeFeedState) {
      return "资讯空间不可用。";
    }

    if (!this.host.ithomeFeedState.hasEntered) {
      return "尚未查看，可进去看看最近文章。";
    }

    return this.host.ithomeFeedState.unreadCount > 0
      ? `新文章 ${this.host.ithomeFeedState.unreadCount} 篇。`
      : "暂无新文章，可进去看看最近文章。";
  }

  public async listChildren(): Promise<RootAgentState[]> {
    return [];
  }

  public getAvailableInvokeTools(): RootAgentInvokeToolName[] {
    return [...ROOT_AGENT_INVOKE_TOOLS_BY_STATE.ithome];
  }

  public async onFocus(): Promise<LlmMessage[]> {
    if (!this.host.ithomeNewsService) {
      return [];
    }

    const result = await this.host.ithomeNewsService.enterFeed();
    this.host.ithomeFeedState = {
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

    await this.host.ensureIthomeFeedStateLoaded();
    if (
      !this.host.ithomeFeedState ||
      input.event.data.sourceKey !== this.host.ithomeFeedState.kind
    ) {
      return {
        shouldTriggerRound: false,
      };
    }

    this.host.ithomeFeedState.unreadCount += 1;
    return {
      shouldTriggerRound: false,
      stateChanged: true,
    };
  }

  public buildNotificationSummary(): string | null {
    return null;
  }
}
