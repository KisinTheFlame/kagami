import type { Event } from "../event/event.js";
import type { LlmMessage } from "../../../llm/types.js";
import type { RootAgentInvokeToolDefinition } from "../root-agent/session/root-agent-session.js";
import {
  renderSupportedMessageSegments,
  type NapcatReceiveMessageSegment,
} from "../../../napcat/service/napcat-gateway/shared.js";
import type { NapcatGroupMessageData } from "../../../napcat/service/napcat-gateway.service.js";
import { renderServerStaticTemplate } from "../../../common/runtime/read-static-text.js";

const BEIJING_TIME_ZONE = "Asia/Shanghai";

type UserMessage = Extract<LlmMessage, { role: "user" }>;

export function createUserMessage(content: string): UserMessage {
  return {
    role: "user",
    content,
  };
}

export function createWakeReminderMessage(now: Date): UserMessage {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/wake-reminder.hbs", values),
  );
}

export function createWaitResumeMessage(input: {
  reason: "timeout" | "event";
  resumedStateLabel: string;
  eventSummary?: string;
}): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/wait-resume.hbs", {
      resumedStateLabel: input.resumedStateLabel,
      isTimeout: input.reason === "timeout",
      isEvent: input.reason === "event",
      eventSummary: input.eventSummary?.trim(),
    }),
  );
}

export function createStateSystemReminderMessage(input: {
  displayName: string;
  children?: Array<{
    id: string;
    displayName: string;
    description: string;
  }>;
  availableInvokeTools?: RootAgentInvokeToolDefinition[];
}): UserMessage {
  const children = input.children ?? [];
  const availableInvokeTools = input.availableInvokeTools ?? [];
  const lines = ["<system_reminder>"];

  if (children.length > 0) {
    lines.push(`你进入了 ${input.displayName} 节点，有以下子节点可进入：`);
    for (const child of children) {
      lines.push(`- ${child.displayName} (${child.id}): ${child.description}`);
    }
  } else {
    lines.push(`你进入了 ${input.displayName} 节点`);
  }

  if (availableInvokeTools.length === 0) {
    lines.push("当前可用的 invoke 工具：无");
  } else {
    lines.push("当前可用的 invoke 工具：");
    for (const tool of availableInvokeTools) {
      lines.push(`- ${tool.name}: ${tool.description ?? "无说明。"}`);
      const parameterLines = renderInvokeToolParameterLines(tool);
      if (parameterLines.length === 0) {
        lines.push("  参数：无");
        continue;
      }

      lines.push("  参数：");
      for (const parameterLine of parameterLines) {
        lines.push(`  - ${parameterLine}`);
      }
    }
  }
  lines.push("</system_reminder>");

  return createUserMessage(lines.join("\n"));
}

function renderInvokeToolParameterLines(tool: RootAgentInvokeToolDefinition): string[] {
  return Object.entries(tool.parameters.properties).map(([parameterName, propertySchema]) => {
    if (!isRecord(propertySchema)) {
      return parameterName;
    }

    const propertyType =
      typeof propertySchema.type === "string" && propertySchema.type.length > 0
        ? ` (${propertySchema.type})`
        : "";
    const description =
      typeof propertySchema.description === "string" && propertySchema.description.length > 0
        ? `: ${propertySchema.description}`
        : "";

    return `${parameterName}${propertyType}${description}`;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createConversationSummaryMessage(summary: string): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/conversation-summary.hbs", {
      summary: summary.trim(),
    }),
  );
}

export function createPortalSnapshotMessage(
  groups: Array<{ groupId: string; groupName?: string; unreadCount: number; hasEntered: boolean }>,
  feeds: Array<{ kind: "ithome"; label: string; unreadCount: number; hasEntered: boolean }> = [],
): UserMessage {
  const renderedGroups = groups.map(group => {
    const groupLabel = group.groupName
      ? `QQ 群 ${group.groupName} (${group.groupId})`
      : `QQ 群 ${group.groupId}`;

    return {
      ...group,
      groupLabel,
      enterCommandText: `enter(kind="qq_group", id="${group.groupId}")`,
    };
  });
  const renderedFeeds = feeds.map(feed => ({
    ...feed,
    enterCommandText: `enter(kind="${feed.kind}")`,
  }));

  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/portal-snapshot.hbs", {
      groups: renderedGroups,
      feeds: renderedFeeds,
    }),
  );
}

export function createEnterZoneOutMessage(): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/enter-zone-out.hbs"),
  );
}

export function createExitZoneOutMessage(): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/exit-zone-out.hbs"),
  );
}

export function createWebSearchInstructionMessage(question: string): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/web-search-instruction.hbs", {
      question: question.trim(),
    }),
  );
}

export function createIthomeArticleListMessage(input: {
  displayName: string;
  mode: "latest" | "new";
  hiddenNewCount: number;
  articles: Array<{
    id: number;
    title: string;
    url: string;
    publishedAt: Date;
    rssSummary: string;
  }>;
}): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/ithome-article-list.hbs", {
      displayName: input.displayName,
      isNewMode: input.mode === "new",
      hiddenNewCount: input.hiddenNewCount,
      articles: input.articles.map(article => ({
        ...article,
        publishedAtText: formatDateTime(article.publishedAt),
      })),
    }),
  );
}

export function createIthomeArticleDetailMessage(input: {
  title: string;
  url: string;
  publishedAt: Date;
  content: string;
  contentSource: "article_content" | "rss_summary";
  truncated: boolean;
  maxChars: number;
}): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/ithome-article-detail.hbs", {
      title: input.title,
      url: input.url,
      publishedAtText: formatDateTime(input.publishedAt),
      content: input.content.trim(),
      fallbackToSummary: input.contentSource === "rss_summary",
      truncated: input.truncated,
      maxChars: input.maxChars,
    }),
  );
}

export function createMessagesFromEvent(event: Event): UserMessage[] {
  switch (event.type) {
    case "napcat_group_message":
      if ((event.data.messageSegments?.length ?? 0) === 0) {
        return [];
      }

      return [createUserMessage(renderGroupMessagePlainText(event.data))];
    case "news_article_ingested":
      return [];
    default:
      return [];
  }
}

export function createMergedGroupMessagesMessage(
  messages: NapcatGroupMessageData[],
): UserMessage | null {
  if (messages.length === 0) {
    return null;
  }

  return createUserMessage(
    messages.map(message => renderGroupMessagePlainText(message)).join("\n\n"),
  );
}

export function renderGroupMessagePlainText(input: {
  nickname: string;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  const renderedMessage = renderGroupMessageBody(input);
  return renderServerStaticTemplate(import.meta.url, "context/qq-message.hbs", {
    nickname: input.nickname,
    userId: input.userId,
    messageBody: renderedMessage,
  });
}

function renderGroupMessageBody(input: {
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  const segments = input.messageSegments ?? [];
  if (segments.length === 0) {
    return "";
  }

  const rendered = renderSupportedMessageSegments(segments);
  return rendered;
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}
