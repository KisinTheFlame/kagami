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
import type { PersistedAgentContextSnapshot } from "../root-agent/persistence/root-agent-runtime-snapshot.js";
import {
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
  /** 单调修订号：任何改动 items 的操作 +1。持久化侧据此 O(1) 判断是否需要落库。见 AgentContext.getRevision。 */
  private revision = 0;

  public constructor({ systemPrompt, systemPromptFactory }: DefaultAgentContextOptions) {
    this.defaultSystemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        creatorName: "unknown",
        apps: [],
      });
    this.systemPrompt = this.defaultSystemPrompt;
  }

  public getRevision(): number {
    return this.revision;
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return {
      systemPrompt: await this.getSystemPrompt(),
      messages: cloneMessages(this.items.flatMap(renderContextItemToMessages)),
    };
  }

  public async getLastMessage(): Promise<LlmMessage | null> {
    // 上下文只含 llm_message item，每个恒渲染 1 条 message，尾部 item 即尾部 message。
    return this.items.at(-1)?.message ?? null;
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
    this.revision += 1;
  }

  public async reset(): Promise<void> {
    this.systemPrompt = this.defaultSystemPrompt;
    this.items.splice(0, this.items.length);
    this.revision += 1;
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    this.items.push(...messages.map(createContextItemFromMessage));
    this.revision += 1;
  }

  public async appendAssistantTurn(message: AssistantMessage): Promise<void> {
    this.items.push(createContextItemFromMessage(message));
    this.revision += 1;
  }

  public async appendToolResult(input: { toolCallId: string; content: string }): Promise<void> {
    this.items.push(
      createContextItemFromMessage({
        role: "tool",
        toolCallId: input.toolCallId,
        content: input.content,
      }),
    );
    this.revision += 1;
  }

  public async replaceLeadingMessages(count: number, replacement: LlmMessage[]): Promise<void> {
    const itemCut = this.resolveLeadingItemCut(count);
    this.items.splice(0, itemCut, ...replacement.map(createContextItemFromMessage));
    this.revision += 1;
  }

  /**
   * 把"前 count 条 message"映射到"前几个 ContextItem"。上下文只含 llm_message item，
   * 每个 item 恒渲染 1 条 message，故 message 下标与 item 下标 1:1 对齐——前 count 条
   * message 即前 count 个 item。count 超过总数抛错（fail-fast，避免悄悄替换错范围）。
   */
  private resolveLeadingItemCut(count: number): number {
    if (count > this.items.length) {
      throw new Error(
        `replaceLeadingMessages: count ${count} 超过 context 总 message 数 ${this.items.length}。`,
      );
    }
    return count;
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
  return summarizeMessage(item.message, previewLength);
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
