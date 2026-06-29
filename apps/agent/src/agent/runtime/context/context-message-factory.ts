import type { AsyncTaskCompletion } from "@kagami/agent-runtime";
import type { Event } from "../event/event.js";
import type { LlmContentPart, LlmMessage } from "../../../llm/types.js";
import { renderServerStaticTemplate } from "@kagami/server-core/common/runtime/read-static-text";

const BEIJING_TIME_ZONE = "Asia/Shanghai";

type UserMessage = Extract<LlmMessage, { role: "user" }>;

export function createUserMessage(content: string): UserMessage {
  return {
    role: "user",
    content,
  };
}

/**
 * 一条多模态 user 消息：文本 + 原图块。图片原图直接进上下文，不经 vision 转文字。
 * 由 Browser App 的 screenshot 经 append_message Effect（带 image）触发。
 */
export function createUserImageMessage(
  text: string,
  image: { content: string; mimeType: string; filename?: string },
): UserMessage {
  const parts: LlmContentPart[] = [
    { type: "text", text },
    {
      type: "image",
      content: image.content,
      mimeType: image.mimeType,
      ...(image.filename ? { filename: image.filename } : {}),
    },
  ];
  return { role: "user", content: parts };
}

export function createWakeReminderMessage(now: Date): UserMessage {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/wake-reminder.hbs", values),
  );
}

/**
 * 桌面（Portal）reminder：手机 OS 模型下桌面只列出可进入的 App，没有别的子状态。
 * 进入某个 App 用 enter；App 之间直接切用 switch；从 App 回桌面用 back_to_portal。
 */
export function createPortalReminderMessage(input: {
  apps: Array<{ id: string; displayName: string }>;
}): UserMessage {
  const lines = ["<system_reminder>", "你现在在桌面（Portal）。"];

  if (input.apps.length > 0) {
    lines.push("可以进入以下 App（用 enter）：");
    for (const app of input.apps) {
      lines.push(`- ${app.id}：${app.displayName}`);
    }
  } else {
    lines.push("当前没有可进入的 App。");
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

/**
 * 异步工具任务完成后的回流消息：包成一条 `<async_tool_result>` user message 追加到尾部。
 * 凭 task_id 对应到当初的 `<async_task_submitted>`。content/message 原样插入，不做 XML 转义
 * （与 `<notification>` / `<story_recall>` 一致：给 LLM 阅读的伪标签，下游无 XML 解析器）。
 */
export function createAsyncToolResultMessage(completion: AsyncTaskCompletion): UserMessage {
  const { taskId, toolName, outcome } = completion;
  const head = `<async_tool_result task_id="${taskId}" tool="${toolName}"`;
  if (outcome.status === "success") {
    return createUserMessage(`${head}>\n${outcome.content}\n</async_tool_result>`);
  }
  if (outcome.status === "error") {
    return createUserMessage(`${head} status="error">\n${outcome.message}\n</async_tool_result>`);
  }
  return createUserMessage(`${head} status="timeout">\n任务超时未完成\n</async_tool_result>`);
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

export function createMessagesFromEvent(_event: Event): UserMessage[] {
  // 目前没有任何事件类型需要渲染成上下文消息：notification / story_recall 由 session
  // 直接装配成 <notification> / <story_recall> 消息追加（不是 event 类 ContextItem），
  // wake 是纯唤醒。保留此入口是为 event→ContextItem 渲染路径留口子——未来若有需要直接
  // 进上下文的新事件类型，在这里加分支即可。
  return [];
}
