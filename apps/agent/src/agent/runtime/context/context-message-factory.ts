import type { AsyncTaskCompletion } from "@kagami/agent-runtime";
import type { Event } from "../event/event.js";
import type { LlmContentPart, LlmMessage } from "@kagami/llm-client";
import { renderServerStaticTemplate } from "@kagami/kernel/runtime/read-static-text";

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
 * 桌面（Portal）reminder：手机 OS 模型下桌面只是初始状态，离开后不可返回。
 * 进入 / 切换 App 一律用 switch；想知道有哪些 App 用 list_apps。
 */
export function createPortalReminderMessage(input: {
  apps: Array<{ id: string; displayName: string }>;
}): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/portal-reminder.hbs", {
      apps: input.apps,
      hasApps: input.apps.length > 0,
    }),
  );
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

/**
 * 手机 OS 模型的统一通知消息：NotificationCenter 聚合后每源一行，包在
 * `<notification>` 标签里追加到上下文尾部。`lines` 已由各源 Draft 渲染好。
 */
export function createNotificationMessage(lines: string[]): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/notification.hbs", { lines }),
  );
}

/**
 * 前台输入消息：当前前台 App drain 出的实时输入，文本已由 App 自己的模板渲染好、
 * 自带伪标签（如 QQ 的 `<qq_conversation_new_messages>`），这里只做薄包装成 user
 * message，不再套第二层标签。与 `<notification>` / `<async_tool_result>` 同为
 * 「事件 → 尾部 append」路径的消息装配点，收在同一处可审。
 */
export function createForegroundInputMessage(text: string): UserMessage {
  return createUserMessage(text);
}

/**
 * 异步工具任务完成后的回流消息：包成一条 `<async_tool_result>` user message 追加到尾部。
 * 凭 task_id 对应到当初的 `<async_task_submitted>`。content/message 原样插入，不做 XML 转义
 * （与 `<notification>` 一致：给 LLM 阅读的伪标签，下游无 XML 解析器）。
 */
export function createAsyncToolResultMessage(completion: AsyncTaskCompletion): UserMessage {
  const { taskId, toolName, outcome } = completion;
  const view =
    outcome.status === "success"
      ? { status: "", isTimeout: false, body: outcome.content }
      : outcome.status === "error"
        ? { status: "error", isTimeout: false, body: outcome.message }
        : { status: "timeout", isTimeout: true, body: "" };
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/async-tool-result.hbs", {
      taskId,
      toolName,
      ...view,
    }),
  );
}

export function createWebSearchInstructionMessage(question: string): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/web-search-instruction.hbs", {
      question: question.trim(),
    }),
  );
}

/**
 * todo「发现待办」子任务的指令消息：追加到 fork 出的主上下文尾部，让子调用回顾生活上下文、
 * 结合当前未完成清单去重后，用 propose_todos 提交最多 5 条具体候选待办。
 */
export function createTodoSuggestionInstructionMessage(
  openTodos: { title: string }[],
): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/todo-suggestion-instruction.hbs", {
      openTodos: openTodos.map(todo => todo.title),
      hasOpenTodos: openTodos.length > 0,
    }),
  );
}

/**
 * 内心独白回流消息：摸鱼判定触发、inner-voice Operation 产出的念头，包成一条
 * `<inner_thought>` user message 追加到尾部——在小镜看来这是她自己冒出来的念头，
 * 不是任务也不是要求（issue #265）。
 */
export function createInnerThoughtMessage(thought: string): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/inner-thought.hbs", {
      thought: thought.trim(),
    }),
  );
}

/**
 * inner-voice Operation 的指令消息：追加到主上下文尾部切片之后，让隔离子调用以小镜
 * 口吻产出（或放弃产出）一个锚定近期真实经历的念头，经 emit_inner_thought 提交。
 */
export function createInnerVoiceInstructionMessage(): UserMessage {
  return createUserMessage(
    renderServerStaticTemplate(import.meta.url, "context/inner-voice-instruction.hbs"),
  );
}

export function createMessagesFromEvent(_event: Event): UserMessage[] {
  // 目前没有任何事件类型需要渲染成上下文消息：notification 由 session 直接装配成
  // <notification> 消息追加（不是 event 类 ContextItem），wake 是纯唤醒。保留此入口是为
  // event→ContextItem 渲染路径留口子——未来若有需要直接进上下文的新事件类型，在这里加分支即可。
  return [];
}
