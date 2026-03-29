import type { LlmMessage } from "../../../llm/types.js";
import { createAgentSystemPrompt } from "../root-agent/system-prompt.js";
import { createMessagesFromEvent } from "./context-message-factory.js";
import { renderGroupMessagePlainText } from "./context-message-factory.js";
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

const DEFAULT_DASHBOARD_LIMIT = 5;
const DEFAULT_PREVIEW_LENGTH = 200;

type DefaultAgentContextOptions = {
  systemPrompt?: string;
  systemPromptFactory?: () => Promise<string> | string;
};

export class DefaultAgentContext implements AgentContext {
  private systemPrompt: string | (() => Promise<string> | string);
  private readonly items: ContextItem[] = [];

  public constructor({ systemPrompt, systemPromptFactory }: DefaultAgentContextOptions) {
    this.systemPrompt =
      systemPromptFactory ??
      systemPrompt ??
      createAgentSystemPrompt({
        botQQ: "unknown",
        creatorName: "unknown",
        creatorQQ: "unknown",
      });
  }

  public async getSnapshot(): Promise<AgentContextSnapshot> {
    return {
      systemPrompt: await this.getSystemPrompt(),
      messages: this.items.flatMap(renderContextItemToMessages),
    };
  }

  public async fork(): Promise<AgentContext> {
    const snapshot = await this.getSnapshot();
    const forkedContext = new DefaultAgentContext({
      systemPrompt: snapshot.systemPrompt,
    });

    await forkedContext.appendMessages(cloneMessages(snapshot.messages));

    return forkedContext;
  }

  public async exportPersistedSnapshot(): Promise<PersistedAgentContextSnapshot> {
    const snapshot = await this.getSnapshot();
    return {
      systemPrompt: snapshot.systemPrompt,
      messages: cloneMessages(snapshot.messages),
    };
  }

  public async restorePersistedSnapshot(snapshot: PersistedAgentContextSnapshot): Promise<void> {
    this.systemPrompt = snapshot.systemPrompt;
    this.items.splice(
      0,
      this.items.length,
      ...cloneMessages(snapshot.messages).map(
        message => ({ kind: "llm_message", message }) as const,
      ),
    );
  }

  public async appendEvents(events: Event[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    this.items.push(...events.map(event => ({ kind: "event", event }) as const));
  }

  public async appendMessages(messages: LlmMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    this.items.push(...messages.map(message => ({ kind: "llm_message", message }) as const));
  }

  public async appendAssistantTurn(message: AssistantMessage): Promise<void> {
    this.items.push({
      kind: "llm_message",
      message,
    });
  }

  public async appendToolResult(input: { toolCallId: string; content: string }): Promise<void> {
    this.items.push({
      kind: "llm_message",
      message: {
        role: "tool",
        toolCallId: input.toolCallId,
        content: input.content,
      },
    });
  }

  public async replaceMessages(messages: LlmMessage[]): Promise<void> {
    this.items.splice(
      0,
      this.items.length,
      ...messages.map(message => ({ kind: "llm_message", message }) as const),
    );
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

function renderContextItemToMessages(item: ContextItem): LlmMessage[] {
  if (item.kind === "llm_message") {
    return [item.message];
  }

  return createMessagesFromEvent(item.event);
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
    case "napcat_group_message": {
      const preview = truncateText(
        renderGroupMessagePlainText({
          nickname: event.data.nickname,
          userId: event.data.userId,
          rawMessage: event.data.rawMessage,
          messageSegments: event.data.messageSegments,
        }),
        previewLength,
      );

      return {
        kind: "event",
        label: "QQ群消息事件",
        preview: preview.text,
        truncated: preview.truncated,
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
  content: string | import("../../../llm/types.js").LlmContentPart[],
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
