import type { LlmMessage } from "@kagami/llm-client";
import { createAgentSystemPrompt } from "../root-agent/system-prompt.js";
import type {
  AgentContext,
  AgentContextDashboardItem,
  AgentContextDashboardSummary,
  AgentContextSnapshot,
  AssistantMessage,
  ContextItem,
} from "./agent-context.js";
import type { Event } from "../event/event.js";
import type { PersistedAgentContextSnapshot } from "../root-agent/persistence/root-agent-runtime-snapshot.js";
import {
  createContextItemFromEvent,
  createContextItemFromMessage,
  renderContextItemToMessages,
} from "./context-item.utils.js";

const DEFAULT_DASHBOARD_LIMIT = 5;
const DEFAULT_PREVIEW_LENGTH = 200;

type DefaultAgentContextOptions = {
  systemPrompt?: string;
  systemPromptFactory?: () => Promise<string> | string;
};

export class DefaultAgentContext implements AgentContext {
  private readonly defaultSystemPrompt: string | (() => Promise<string> | string);
  private systemPrompt: string | (() => Promise<string> | string);
  private readonly items: ContextItem[] = [];

  public constructor({ systemPrompt, systemPromptFactory }: DefaultAgentContextOptions) {
    this.defaultSystemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
        creatorName: "unknown",
        creatorQQ: "unknown",
      });
    this.systemPrompt = this.defaultSystemPrompt;
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return {
      systemPrompt: await this.getSystemPrompt(),
      messages: cloneMessages(this.items.flatMap(renderContextItemToMessages)),
    };
  }

  public async fork(): Promise<AgentContext> {
    const snapshot = await this.getSnapshot();
    const forkedContext = new DefaultAgentContext({
      systemPrompt: snapshot.systemPrompt,
    });

    await forkedContext.appendMessages(snapshot.messages);

    return forkedContext;
  }

  public async exportPersistedSnapshot(): Promise<PersistedAgentContextSnapshot> {
    const snapshot = await this.getSnapshot();
    return {
      messages: snapshot.messages,
    };
  }

  public async restorePersistedSnapshot(snapshot: PersistedAgentContextSnapshot): Promise<void> {
    this.items.splice(
      0,
      this.items.length,
      ...cloneMessages(snapshot.messages).map(
        message => ({ kind: "llm_message", message }) as const,
      ),
    );
  }

  public async reset(): Promise<void> {
    this.systemPrompt = this.defaultSystemPrompt;
    this.items.splice(0, this.items.length);
  }

  public async appendEvents(events: Event[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    this.items.push(...events.map(createContextItemFromEvent));
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    this.items.push(...messages.map(createContextItemFromMessage));
  }

  public async appendAssistantTurn(message: AssistantMessage): Promise<void> {
    this.items.push(createContextItemFromMessage(message));
  }

  public async appendToolResult(input: { toolCallId: string; content: string }): Promise<void> {
    this.items.push(
      createContextItemFromMessage({
        role: "tool",
        toolCallId: input.toolCallId,
        content: input.content,
      }),
    );
  }

  public async replaceLeadingMessages(count: number, replacement: LlmMessage[]): Promise<void> {
    const itemCut = this.resolveLeadingItemCut(count);
    this.items.splice(0, itemCut, ...replacement.map(createContextItemFromMessage));
  }

  /**
   * 把"前 count 条 message"映射到"前几个 ContextItem"。
   *
   * 一个 event item 可能渲染成 0 条 message（如 friend_list / ithome 事件），所以
   * message 数和 item 数不一定相等。从头累加每个 item 渲染出的 message 数，正好
   * 累加到 count 时即为切点；达到 count 后继续吞掉紧跟的 0-message item（它们属于
   * 已摘要前缀、不产新 message，吞掉才能让全量压缩彻底清空头部）。
   *
   * 若某个 item 渲染成多条 message、导致累加从 <count 直接跳过 count，说明 count
   * 落在 item 内部、无法在边界对齐——抛错（fail-fast，避免悄悄替换错范围）。
   */
  private resolveLeadingItemCut(count: number): number {
    let seen = 0;
    let itemCut = 0;
    for (let i = 0; i < this.items.length; i += 1) {
      const rendered = renderContextItemToMessages(this.items[i]).length;
      if (seen === count) {
        if (rendered !== 0) {
          break;
        }
        // 紧跟在 count 边界后的 0-message item，并入已替换前缀。
        itemCut = i + 1;
        continue;
      }
      seen += rendered;
      itemCut = i + 1;
      if (seen > count) {
        throw new Error(
          `replaceLeadingMessages: count ${count} 落在 ContextItem 内部，无法在 item ` +
            `边界对齐（某 item 渲染成多条 message）。`,
        );
      }
    }
    if (seen !== count) {
      throw new Error(
        `replaceLeadingMessages: count ${count} 超过 context 总 message 数 ${seen}。`,
      );
    }
    return itemCut;
  }

  public async getDashboardSummary(input?: {
    limit?: number;
    previewLength?: number;
  }): Promise<AgentContextDashboardSummary> {
    const limit = input?.limit ?? DEFAULT_DASHBOARD_LIMIT;
    const previewLength = input?.previewLength ?? DEFAULT_PREVIEW_LENGTH;
    const recentItems = this.items
      .slice(Math.max(0, this.items.length - limit))
      .map(item => renderContextItemToDashboardItem(item, previewLength));

    return {
      messageCount: this.items.flatMap(renderContextItemToMessages).length,
      recentItems,
      recentItemsTruncated: this.items.length > limit,
    };
  }

  private async getSystemPrompt(): Promise<string> {
    if (typeof this.systemPrompt === "function") {
      return await this.systemPrompt();
    }

    return this.systemPrompt;
  }
}

function cloneMessages(messages: LlmMessage[]): LlmMessage[] {
  return structuredClone(messages);
}

function renderContextItemToDashboardItem(
  item: ContextItem,
  previewLength: number,
): AgentContextDashboardItem {
  if (item.kind === "event") {
    return summarizeEvent(item.event, previewLength);
  }

  return summarizeMessage(item.message, previewLength);
}

function summarizeEvent(event: Event, previewLength: number): AgentContextDashboardItem {
  switch (event.type) {
    case "notification": {
      const summary = truncateText(event.data.lines.join("；"), previewLength);
      return {
        kind: "event",
        label: "通知事件",
        preview: summary.text,
        truncated: summary.truncated,
      };
    }
    default:
      return {
        kind: "event",
        label: "事件",
        preview: "",
        truncated: false,
      };
  }
}

function summarizeMessage(message: LlmMessage, previewLength: number): AgentContextDashboardItem {
  switch (message.role) {
    case "user": {
      const preview = truncateText(renderUserMessagePreview(message.content), previewLength);
      return {
        kind: "llm_message",
        label: "用户消息",
        preview: preview.text,
        truncated: preview.truncated,
      };
    }
    case "assistant": {
      const previewSource =
        message.content.trim().length > 0
          ? message.content
          : `工具调用：${message.toolCalls.map(toolCall => toolCall.name).join(", ")}`;
      const preview = truncateText(previewSource, previewLength);

      return {
        kind: "llm_message",
        label: "Assistant",
        preview: preview.text,
        truncated: preview.truncated,
      };
    }
    case "tool": {
      const preview = truncateText(message.content, previewLength);
      return {
        kind: "llm_message",
        label: `工具结果 ${message.toolCallId}`,
        preview: preview.text,
        truncated: preview.truncated,
      };
    }
  }
}

function renderUserMessagePreview(
  content: string | import("@kagami/llm-client").LlmContentPart[],
): string {
  if (typeof content === "string") {
    return content;
  }

  const parts = content.map(part => {
    if (part.type === "text") {
      return part.text;
    }

    return `[图片${part.filename ? `:${part.filename}` : ""}]`;
  });

  return parts.join("\n");
}

function truncateText(input: string, maxLength: number): { text: string; truncated: boolean } {
  const normalized = input.trim();
  if (normalized.length <= maxLength) {
    return {
      text: normalized,
      truncated: false,
    };
  }

  return {
    text: `${normalized.slice(0, Math.max(0, maxLength - 1))}…`,
    truncated: true,
  };
}
