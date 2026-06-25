import type { Event } from "../event/event.js";
import type { LlmMessage } from "../../../llm/types.js";
import {
  renderSupportedMessageSegments,
  type NapcatReceiveMessageSegment,
} from "../../../napcat/service/napcat-gateway/shared.js";
import type {
  NapcatGroupMessageData,
  NapcatPrivateMessageData,
} from "../../../napcat/service/napcat-gateway.service.js";
import { renderServerStaticTemplate } from "../../../common/runtime/read-static-text.js";
import type { HnFeed } from "../../apps/hn/client/firebase.js";
import type {
  HnGlanceResult,
  HnThreadResult,
  HnSearchResult,
  HnUserResult,
} from "../../apps/hn/hn-reader.js";

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
  apps?: Array<{
    id: string;
    displayName: string;
  }>;
}): UserMessage {
  const children = input.children ?? [];
  const apps = input.apps ?? [];
  const lines = ["<system_reminder>"];

  if (children.length > 0) {
    lines.push(`你进入了 ${input.displayName} 节点，有以下子节点可进入：`);
    for (const child of children) {
      lines.push(`- ${child.displayName} (${child.id}): ${child.description}`);
    }
  } else {
    lines.push(`你进入了 ${input.displayName} 节点`);
  }

  if (apps.length > 0) {
    lines.push("也可以进入以下 App：");
    for (const app of apps) {
      lines.push(`- ${app.id}：${app.displayName}`);
    }
  }

  lines.push("</system_reminder>");

  return createUserMessage(lines.join("\n"));
}

export function createConversationSummaryMessage(summary: string): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/conversation-summary.hbs", {
      summary: summary.trim(),
    }),
  );
}

export function createRootContextSummaryReminderMessage(): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/root-context-summary-reminder.hbs"),
  );
}

export function createStoryContextSummaryReminderMessage(): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/story-context-summary-reminder.hbs"),
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

export type CrossStateNotification = {
  stateId: string;
  displayName: string;
  summary: string;
};

export function createCrossStateNotificationMessage(
  notifications: CrossStateNotification[],
): UserMessage {
  const lines = [
    "<system_reminder>",
    "[跨状态通知]",
    "以下状态有新的活动，你可以决定是否需要切换过去处理：",
  ];

  for (const notification of notifications) {
    lines.push(`- ${notification.displayName}：${notification.summary}`);
  }

  lines.push("你可以使用 back 工具返回门户，再 enter 到需要处理的状态。也可以继续当前对话。");
  lines.push("</system_reminder>");
  return createUserMessage(lines.join("\n"));
}

/**
 * 手机 OS 模型的统一通知消息：NotificationCenter 聚合后每源一行，包在
 * `<notification>` 标签里追加到上下文尾部。`lines` 已由各源 Draft 渲染好。
 */
export function createNotificationMessage(lines: string[]): UserMessage {
  return createUserMessage(["<notification>", ...lines, "</notification>"].join("\n"));
}

export function createStoryRecallMessage(
  stories: Array<{ id: string; markdown: string; createdAt: Date }>,
): UserMessage {
  const parts = stories.map(story => {
    const date = formatStoryRecallDate(story.createdAt);
    return [`你想起了一件发生在 ${date} 的事情：`, "", story.markdown].join("\n");
  });

  return createUserMessage(["<story_recall>", ...parts, "</story_recall>"].join("\n"));
}

function formatStoryRecallDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function createWebSearchInstructionMessage(question: string): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/web-search-instruction.hbs", {
      question: question.trim(),
    }),
  );
}

type IthomeArticleListInput = {
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
};

export function renderIthomeArticleListContent(input: IthomeArticleListInput): string {
  return renderServerStaticTemplate(import.meta.url, "context/ithome-article-list.hbs", {
    displayName: input.displayName,
    isNewMode: input.mode === "new",
    hiddenNewCount: input.hiddenNewCount,
    articles: input.articles.map(article => ({
      ...article,
      publishedAtText: formatDateTime(article.publishedAt),
    })),
  });
}

export function createIthomeArticleListMessage(input: IthomeArticleListInput): UserMessage {
  return createUserMessage(renderIthomeArticleListContent(input));
}

type IthomeArticleDetailInput = {
  title: string;
  url: string;
  publishedAt: Date;
  content: string;
  contentSource: "article_content" | "rss_summary";
  truncated: boolean;
  maxChars: number;
};

export function renderIthomeArticleDetailContent(input: IthomeArticleDetailInput): string {
  return renderServerStaticTemplate(import.meta.url, "context/ithome-article-detail.hbs", {
    title: input.title,
    url: input.url,
    publishedAtText: formatDateTime(input.publishedAt),
    content: input.content.trim(),
    fallbackToSummary: input.contentSource === "rss_summary",
    truncated: input.truncated,
    maxChars: input.maxChars,
  });
}

export function createIthomeArticleDetailMessage(input: IthomeArticleDetailInput): UserMessage {
  return createUserMessage(renderIthomeArticleDetailContent(input));
}

// === Hacker News App 屏幕渲染 ===
// 领域模型已在 HnReader 里清洗过（htmlToPlainText 去标签 + 软化尖括号），
// 所以这里直接拼进 <hn_*> XML 段落是安全的——HN 文本无法伪造闭合标签越狱。

const HN_FEED_LABEL: Record<HnFeed, string> = {
  top: "热榜",
  new: "最新",
  best: "最佳",
  ask: "Ask HN",
  show: "Show HN",
  job: "招聘",
};

export function renderHnFrontPageContent(result: HnGlanceResult): string {
  const lines = [`<hn_front_page feed="${HN_FEED_LABEL[result.feed]}">`];
  if (result.stories.length === 0) {
    lines.push("（这个榜单暂时没拉到内容）");
  }
  result.stories.forEach((story, index) => {
    const meta = [
      story.score !== null ? `${story.score} 分` : null,
      story.descendants !== null ? `${story.descendants} 评论` : null,
      story.by ? `by ${story.by}` : null,
      story.domain,
      story.postedAt ? formatDateTime(story.postedAt) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${index + 1}. [id=${story.id}] ${story.title}`);
    if (meta) {
      lines.push(`   ${meta}`);
    }
  });
  lines.push("</hn_front_page>");
  return lines.join("\n");
}

export function renderHnThreadContent(result: HnThreadResult): string {
  const lines = [`<hn_thread id="${result.id}">`];
  lines.push(result.title ?? "(无标题)");
  const head = [
    result.by ? `by ${result.by}` : null,
    result.domain,
    result.postedAt ? formatDateTime(result.postedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (head) {
    lines.push(head);
  }
  if (result.url) {
    lines.push(`链接：${result.url}`);
  }
  if (result.selfText) {
    lines.push("", result.selfText);
  }
  lines.push("", `--- 讨论（${result.shownRootComments}/${result.totalRootComments} 条主楼）---`);
  if (result.comments.length === 0) {
    lines.push("（还没有评论）");
  }
  for (const comment of result.comments) {
    const indent = comment.depth > 1 ? "    " : "";
    const replyHint = comment.replyCount > 0 ? `（${comment.replyCount} 回复）` : "";
    const author = comment.author ?? "(匿名)";
    lines.push(`${indent}- ${author}${replyHint}：${comment.text || "（空）"}`);
  }
  if (result.truncated) {
    lines.push("", "（讨论已截断，还有更多评论没展开）");
  }
  lines.push("</hn_thread>");
  return lines.join("\n");
}

export function renderHnSearchContent(result: HnSearchResult): string {
  const sortLabel = result.sort === "date" ? "按时间" : "按热度";
  const lines = [`<hn_search query="${result.query}" sort="${sortLabel}">`];
  if (result.hits.length === 0) {
    lines.push("（没搜到相关内容）");
  }
  result.hits.forEach((hit, index) => {
    const meta = [
      hit.kind === "comment" ? "评论" : "帖子",
      hit.points !== null ? `${hit.points} 分` : null,
      hit.numComments !== null ? `${hit.numComments} 评论` : null,
      hit.author ? `by ${hit.author}` : null,
      hit.domain,
      hit.postedAt ? formatDateTime(hit.postedAt) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const head = hit.title ?? hit.snippet ?? "(无标题)";
    lines.push(`${index + 1}. [id=${hit.id}] ${head}`);
    lines.push(`   ${meta}`);
    if (hit.title && hit.snippet) {
      lines.push(`   ${hit.snippet}`);
    }
  });
  lines.push("</hn_search>");
  return lines.join("\n");
}

export function renderHnUserContent(result: HnUserResult): string {
  const lines = [`<hn_user name="${result.username}">`];
  if (!result.found) {
    lines.push(`没找到用户 ${result.username}。`);
    lines.push("</hn_user>");
    return lines.join("\n");
  }
  const meta = [
    result.karma !== null ? `karma ${result.karma}` : null,
    result.createdAt ? `注册于 ${formatDateTime(result.createdAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (meta) {
    lines.push(meta);
  }
  if (result.about) {
    lines.push("", result.about);
  }
  lines.push("", "--- 近期发言 ---");
  if (result.recent.length === 0) {
    lines.push("（最近没有发言）");
  }
  for (const item of result.recent) {
    const kind = item.kind === "comment" ? "评论" : "帖子";
    const when = item.postedAt ? formatDateTime(item.postedAt) : "";
    const body = item.title ?? item.snippet ?? "(无内容)";
    lines.push(`- [${kind}${when ? ` ${when}` : ""}] ${body}`);
  }
  lines.push("</hn_user>");
  return lines.join("\n");
}

export function createMessagesFromEvent(event: Event): UserMessage[] {
  switch (event.type) {
    case "napcat_group_message":
      if ((event.data.messageSegments?.length ?? 0) === 0) {
        return [];
      }

      return [createUserMessage(renderGroupMessagePlainText(event.data))];
    case "napcat_private_message":
      if ((event.data.messageSegments?.length ?? 0) === 0) {
        return [];
      }

      return [createUserMessage(renderPrivateMessagePlainText(event.data))];
    case "napcat_friend_list_updated":
      return [];
    default:
      // `notification` 事件不走这里——它由 session 直接装配成 <notification> 消息
      // 追加（createNotificationMessage），不是 event 类 ContextItem。
      return [];
  }
}

export function renderMergedGroupMessagesContent(
  messages: NapcatGroupMessageData[],
): string | null {
  if (messages.length === 0) {
    return null;
  }
  return messages.map(message => renderGroupMessagePlainText(message)).join("\n\n");
}

export function createMergedGroupMessagesMessage(
  messages: NapcatGroupMessageData[],
): UserMessage | null {
  const content = renderMergedGroupMessagesContent(messages);
  return content === null ? null : createUserMessage(content);
}

export function renderMergedPrivateMessagesContent(
  messages: NapcatPrivateMessageData[],
): string | null {
  if (messages.length === 0) {
    return null;
  }
  return messages.map(message => renderPrivateMessagePlainText(message)).join("\n\n");
}

export function createMergedPrivateMessagesMessage(
  messages: NapcatPrivateMessageData[],
): UserMessage | null {
  if (messages.length === 0) {
    return null;
  }

  return createUserMessage(
    messages.map(message => renderPrivateMessagePlainText(message)).join("\n\n"),
  );
}

export function renderGroupMessagePlainText(input: {
  nickname: string;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  return renderQqMessagePlainText({
    displayName: input.nickname,
    userId: input.userId,
    rawMessage: input.rawMessage,
    messageSegments: input.messageSegments,
  });
}

export function renderPrivateMessagePlainText(input: {
  nickname: string;
  remark: string | null;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  return renderQqMessagePlainText({
    displayName: formatPrivateChatDisplayName(input),
    userId: input.userId,
    rawMessage: input.rawMessage,
    messageSegments: input.messageSegments,
  });
}

export function formatPrivateChatDisplayName(input: {
  nickname: string;
  remark: string | null;
  userId: string;
}): string {
  const remark = input.remark?.trim();
  if (remark) {
    return remark;
  }

  const nickname = input.nickname.trim();
  if (nickname) {
    return nickname;
  }

  return input.userId;
}

function renderQqMessagePlainText(input: {
  displayName: string;
  userId: string;
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  const renderedMessage = renderQqMessageBody(input);
  return renderServerStaticTemplate(import.meta.url, "context/qq-message.hbs", {
    nickname: input.displayName,
    userId: input.userId,
    messageBody: renderedMessage,
  });
}

function renderQqMessageBody(input: {
  rawMessage: string;
  messageSegments?: NapcatReceiveMessageSegment[];
}): string {
  const segments = input.messageSegments ?? [];
  if (segments.length === 0) {
    return input.rawMessage.trim();
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
