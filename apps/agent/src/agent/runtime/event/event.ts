import type { AsyncTaskCompletion } from "@kagami/agent-runtime";

/**
 * 聚合后的通知事件，由 NotificationCenter 在窗口 flush 时塞进事件队列（手机 OS
 * 模型里 center 是 App→Agent 的唯一桥）。每个 source 一行 `lines`。Session 路由时
 * 装配成一条 `<notification>` user message 追加到上下文尾部，并触发一轮 round。
 * 这条事件进队列本身就是「唤醒」——见 Queue 的 wake-up generality。
 */
export type NotificationEvent = {
  type: "notification";
  data: {
    /** 每个源一行，已渲染好的展示文本。 */
    lines: string[];
  };
};

/**
 * Pure wake event. Produced by internal mechanisms (wait tool timers,
 * stop requests, reset notifications) that need to unblock a consumer
 * waiting on the event queue but have no business-level content to convey.
 *
 * Session routing treats it as a no-op.
 */
export type WakeEvent = {
  type: "wake";
};

export type StoryRecallStoryPayload = {
  id: string;
  markdown: string;
  createdAt: Date;
};

/**
 * 异步工具任务完成后，AsyncTaskManager 的 onComplete 把结果以事件形式塞回主 Agent
 * 的事件队列。Session 路由时装配成一条 `<async_tool_result>` user message 追加到上下文，
 * 并触发新一轮 round，让主 Agent 凭 task_id 对应到当初的发起。
 */
export type AsyncToolResultCompletedEvent = {
  type: "async_tool_result_completed";
  data: AsyncTaskCompletion;
};

/**
 * Story recall 后台任务异步完成后，把召回到的故事以事件形式塞回主 Agent 的事件队列。
 * Session 在路由时把 stories 装配成 <story_recall> user message 并追加到上下文，
 * 同时触发新一轮 round，让主 Agent 想起记忆后继续行动。召回结果为空时不会发出该事件。
 */
export type StoryRecallCompletedEvent = {
  type: "story_recall_completed";
  data: {
    stories: StoryRecallStoryPayload[];
  };
};

export type Event =
  | NotificationEvent
  | StoryRecallCompletedEvent
  | AsyncToolResultCompletedEvent
  | WakeEvent;
